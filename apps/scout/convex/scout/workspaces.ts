import { siteHostnameSchema } from "../../shared/site";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requirePermission, requireUserPermission } from "../access";
import { query } from "../functions";
import {
  MAX_WORKSPACE_ENTRIES,
  MAX_WORKSPACE_BYTES,
  MAX_WORKSPACE_FILE_BYTES,
  WORKSPACE_ROOT,
  workspaceEntryValidator,
  workspaceFileValidator,
  workspaceTargetValidator,
  type WorkspaceTarget,
} from "../workspaceModel";
import { workspaceStorage, workspaceStorageConfigured } from "../workspaceStorage";
import { chatPermission } from "./chatAccess";
import { requireSessionPermission } from "../agentsApi/access";
import { ensureSite } from "./siteListings";

async function requireWorkspaceChat(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  userId: Id<"users">,
) {
  const chat = await ctx.db
    .query("scoutChats")
    .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
    .unique();
  if (!chat || chat.userId !== userId) throw new Error("Chat not found");
  await requireUserPermission(ctx, userId, chatPermission(chat.purpose));
  return chat;
}

async function requireWorkspaceOwner(
  ctx: QueryCtx | MutationCtx,
  target: WorkspaceTarget,
  userId: Id<"users">,
) {
  switch (target.kind) {
    case "chat":
      await requireWorkspaceChat(ctx, target.threadId, userId);
      return;
    case "agent_session": {
      const session = await ctx.db.get(target.sessionId);
      if (!session || session.userId !== userId) throw new Error("Session not found");
      await requireSessionPermission(ctx, session);
      return;
    }
    case "site":
      await requireUserPermission(ctx, userId, "access_play");
      return;
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

async function requireWorkspaceViewer(ctx: QueryCtx, target: WorkspaceTarget) {
  const viewer = await requirePermission(ctx, "access_lab");
  // Agents admins can inspect member sessions, including their files, but cannot write them.
  if (target.kind === "agent_session") {
    if (!(await ctx.db.get(target.sessionId))) throw new Error("Session not found");
    return;
  }
  await requireWorkspaceOwner(ctx, target, viewer.userId);
}

async function workspaceRows(ctx: QueryCtx | MutationCtx, workspaceId: Id<"scoutWorkspaces">) {
  const rows = await ctx.db
    .query("scoutWorkspaceFiles")
    .withIndex("by_workspace_id_and_entry_path", (q) => q.eq("workspaceId", workspaceId))
    .order("asc")
    .take(MAX_WORKSPACE_ENTRIES + 1);
  if (rows.length > MAX_WORKSPACE_ENTRIES) throw new Error("Workspace entry limit exceeded");
  return rows;
}

function findWorkspace(ctx: QueryCtx | MutationCtx, target: WorkspaceTarget) {
  const query = ctx.db.query("scoutWorkspaces");
  switch (target.kind) {
    case "chat":
      return query.withIndex("by_thread_id", (q) => q.eq("threadId", target.threadId)).unique();
    case "agent_session":
      return query.withIndex("by_session_id", (q) => q.eq("sessionId", target.sessionId)).unique();
    case "site":
      return query
        .withIndex("by_site", (q) => q.eq("site", siteHostnameSchema.parse(target.site)))
        .unique();
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

export const listSites = query({
  access: "access_lab",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.string()),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("scoutWorkspaces")
      .withIndex("by_site", (q) => q.gt("site", ""))
      .order("asc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((workspace) => {
        if (workspace.kind !== "site") throw new Error("Expected a site workspace");
        return workspace.site;
      }),
    };
  },
});

export const list = query({
  access: "access_lab",
  args: { target: workspaceTargetValidator },
  returns: v.object({
    exists: v.boolean(),
    configured: v.boolean(),
    cwd: v.string(),
    revision: v.number(),
    entries: v.array(workspaceEntryValidator),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceViewer(ctx, args.target);
    const workspace = await findWorkspace(ctx, args.target);
    return {
      exists: workspace !== null,
      configured: workspaceStorageConfigured(),
      cwd: workspace?.cwd ?? WORKSPACE_ROOT,
      revision: workspace?.revision ?? 0,
      entries: workspace ? (await workspaceRows(ctx, workspace._id)).map((row) => row.entry) : [],
    };
  },
});

export const snapshot = internalMutation({
  args: { target: workspaceTargetValidator, userId: v.id("users") },
  returns: v.object({
    workspaceId: v.id("scoutWorkspaces"),
    site: v.union(v.string(), v.null()),
    cwd: v.string(),
    revision: v.number(),
    entries: v.array(workspaceEntryValidator),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceOwner(ctx, args.target, args.userId);
    if (args.target.kind === "site")
      await ensureSite(ctx, siteHostnameSchema.parse(args.target.site));
    const workspace = await findWorkspace(ctx, args.target);
    if (workspace)
      return {
        workspaceId: workspace._id,
        site: workspace.kind === "site" ? workspace.site : null,
        cwd: workspace.cwd,
        revision: workspace.revision,
        entries: (await workspaceRows(ctx, workspace._id)).map((row) => row.entry),
      };
    const owner: WorkspaceTarget =
      args.target.kind === "site"
        ? { kind: "site", site: siteHostnameSchema.parse(args.target.site) }
        : args.target;
    const workspaceId = await ctx.db.insert("scoutWorkspaces", {
      ...owner,
      cwd: WORKSPACE_ROOT,
      revision: 0,
    });
    return {
      workspaceId,
      site: owner.kind === "site" ? owner.site : null,
      cwd: WORKSPACE_ROOT,
      revision: 0,
      entries: [],
    };
  },
});

export const addFile = internalMutation({
  args: {
    workspaceId: v.id("scoutWorkspaces"),
    userId: v.id("users"),
    entry: workspaceFileValidator,
    overwrite: v.boolean(),
  },
  returns: v.number(),
  handler: async (ctx, { workspaceId, userId, entry, overwrite }) => {
    await requireUserPermission(ctx, userId, "access_play");
    const workspace = await ctx.db.get("scoutWorkspaces", workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    await requireWorkspaceOwner(ctx, workspace, userId);
    const segments = entry.path.split("/");
    if (
      !entry.path.startsWith(`${WORKSPACE_ROOT}/`) ||
      segments
        .slice(1)
        .some(
          (segment) =>
            !segment || segment === "." || segment === ".." || /[\\\p{Cc}]/u.test(segment),
        )
    )
      throw new Error("File path must be an absolute path inside /workspace");
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > MAX_WORKSPACE_FILE_BYTES
    )
      throw new Error(`Workspace file exceeds ${MAX_WORKSPACE_FILE_BYTES} bytes: ${entry.path}`);
    const rows = await workspaceRows(ctx, workspaceId);
    const existing = new Map(rows.map((row) => [row.entry.path, row.entry]));
    const previous = rows.find((row) => row.entry.path === entry.path);
    if (previous && (!overwrite || previous.entry.kind !== "file"))
      throw new Error(`Workspace path already exists: ${entry.path}`);
    const parents: string[] = [];
    for (let depth = 2; depth < segments.length; depth++) {
      const path = segments.slice(0, depth).join("/");
      const parent = existing.get(path);
      if (parent && parent.kind !== "directory")
        throw new Error(`Workspace parent is not a directory: ${path}`);
      if (!parent) parents.push(path);
    }
    if (rows.length + parents.length + (previous ? 0 : 1) > MAX_WORKSPACE_ENTRIES)
      throw new Error(
        "Workspace entry limit exceeded; remove files or folders before reading another page",
      );
    const totalBytes = rows.reduce(
      (sum, row) =>
        sum + (row.entry.kind === "file" && row.entry.path !== entry.path ? row.entry.size : 0),
      entry.size,
    );
    if (totalBytes > MAX_WORKSPACE_BYTES)
      throw new Error("Workspace byte limit exceeded; remove files before reading another page");
    for (const path of parents)
      await ctx.db.insert("scoutWorkspaceFiles", {
        workspaceId,
        entry: { kind: "directory", path, mode: 0o755, mtime: entry.mtime },
      });
    if (previous) {
      await ctx.db.patch(previous._id, { entry });
      if (previous.entry.kind === "file" && previous.entry.key !== entry.key)
        await workspaceStorage().deleteObject(ctx, previous.entry.key);
    } else {
      await ctx.db.insert("scoutWorkspaceFiles", { workspaceId, entry });
    }
    const revision = workspace.revision + 1;
    await ctx.db.patch("scoutWorkspaces", workspaceId, { revision });
    return revision;
  },
});

export const commit = internalMutation({
  args: {
    workspaceId: v.id("scoutWorkspaces"),
    userId: v.id("users"),
    expectedRevision: v.number(),
    cwd: v.string(),
    entries: v.array(workspaceEntryValidator),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("scoutWorkspaces", args.workspaceId);
    if (!workspace || workspace.revision !== args.expectedRevision) {
      throw new Error(
        "Another command changed this workspace. These changes were not saved; inspect the files before retrying.",
      );
    }
    await requireWorkspaceOwner(ctx, workspace, args.userId);
    if (args.entries.length > MAX_WORKSPACE_ENTRIES)
      throw new Error("Workspace entry limit exceeded");
    const rows = await workspaceRows(ctx, workspace._id);
    const next = new Map(args.entries.map((entry) => [entry.path, entry]));
    if (next.size !== args.entries.length) throw new Error("Duplicate workspace paths");
    const retainedKeys = new Set(
      args.entries.flatMap((entry) => (entry.kind === "file" ? [entry.key] : [])),
    );
    const removedKeys = new Set<string>();
    for (const row of rows) {
      const entry = next.get(row.entry.path);
      if (entry) {
        if (JSON.stringify(entry) !== JSON.stringify(row.entry))
          await ctx.db.patch("scoutWorkspaceFiles", row._id, { entry });
        next.delete(row.entry.path);
      } else {
        await ctx.db.delete("scoutWorkspaceFiles", row._id);
      }
      if (row.entry.kind === "file" && !retainedKeys.has(row.entry.key))
        removedKeys.add(row.entry.key);
    }
    for (const entry of next.values())
      await ctx.db.insert("scoutWorkspaceFiles", { workspaceId: workspace._id, entry });
    const revision = workspace.revision + 1;
    await ctx.db.patch("scoutWorkspaces", workspace._id, { cwd: args.cwd, revision });
    if (removedKeys.size) {
      const storage = workspaceStorage();
      for (const key of removedKeys) await storage.deleteObject(ctx, key);
    }
    return revision;
  },
});

export const fileForViewer = internalQuery({
  args: { target: workspaceTargetValidator, path: v.string() },
  returns: workspaceEntryValidator,
  handler: async (ctx, args) => {
    await requireWorkspaceViewer(ctx, args.target);
    const workspace = await findWorkspace(ctx, args.target);
    if (!workspace) throw new Error("File not found");
    const row = await ctx.db
      .query("scoutWorkspaceFiles")
      .withIndex("by_workspace_id_and_entry_path", (q) =>
        q.eq("workspaceId", workspace._id).eq("entry.path", args.path),
      )
      .unique();
    if (!row) throw new Error("File not found");
    return row.entry;
  },
});
