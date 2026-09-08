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
  siteWorkspaceSchema,
  workspaceTargetValidator,
  type WorkspaceTarget,
} from "../workspaceModel";
import { workspaceStorage, workspaceStorageConfigured } from "../workspaceStorage";

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
  return chat;
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
  return target.kind === "chat"
    ? query.withIndex("by_thread_id", (q) => q.eq("threadId", target.threadId)).unique()
    : query
        .withIndex("by_site", (q) => q.eq("site", siteWorkspaceSchema.parse(target.site)))
        .unique();
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
    if (args.target.kind === "chat")
      await requireWorkspaceChat(ctx, args.target.threadId, ctx.viewer.userId);
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
    await requireUserPermission(ctx, args.userId, "access_lab");
    if (args.target.kind === "chat")
      await requireWorkspaceChat(ctx, args.target.threadId, args.userId);
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
      args.target.kind === "chat"
        ? args.target
        : { kind: "site", site: siteWorkspaceSchema.parse(args.target.site) };
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
  },
  returns: v.number(),
  handler: async (ctx, { workspaceId, userId, entry }) => {
    await requireUserPermission(ctx, userId, "access_lab");
    const workspace = await ctx.db.get("scoutWorkspaces", workspaceId);
    if (!workspace || workspace.kind !== "chat")
      throw new Error("Private chat workspace not found");
    await requireWorkspaceChat(ctx, workspace.threadId, userId);
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
    if (existing.has(entry.path)) throw new Error(`Workspace path already exists: ${entry.path}`);
    const parents: string[] = [];
    for (let depth = 2; depth < segments.length; depth++) {
      const path = segments.slice(0, depth).join("/");
      const parent = existing.get(path);
      if (parent && parent.kind !== "directory")
        throw new Error(`Workspace parent is not a directory: ${path}`);
      if (!parent) parents.push(path);
    }
    if (rows.length + parents.length + 1 > MAX_WORKSPACE_ENTRIES)
      throw new Error(
        "Workspace entry limit exceeded; remove files or folders before reading another page",
      );
    const totalBytes = rows.reduce(
      (sum, row) => sum + (row.entry.kind === "file" ? row.entry.size : 0),
      entry.size,
    );
    if (totalBytes > MAX_WORKSPACE_BYTES)
      throw new Error("Workspace byte limit exceeded; remove files before reading another page");
    for (const path of parents)
      await ctx.db.insert("scoutWorkspaceFiles", {
        workspaceId,
        entry: { kind: "directory", path, mode: 0o755, mtime: entry.mtime },
      });
    await ctx.db.insert("scoutWorkspaceFiles", { workspaceId, entry });
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
    await requireUserPermission(ctx, args.userId, "access_lab");
    const workspace = await ctx.db.get("scoutWorkspaces", args.workspaceId);
    if (!workspace || workspace.revision !== args.expectedRevision) {
      throw new Error(
        "Another command changed this workspace. These changes were not saved; inspect the files before retrying.",
      );
    }
    if (workspace.kind === "chat") await requireWorkspaceChat(ctx, workspace.threadId, args.userId);
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
    const viewer = await requirePermission(ctx, "access_lab");
    if (args.target.kind === "chat")
      await requireWorkspaceChat(ctx, args.target.threadId, viewer.userId);
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
