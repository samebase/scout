import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requirePermission, requireUserPermission } from "../access";
import { query } from "../functions";
import { MAX_WORKSPACE_ENTRIES, WORKSPACE_ROOT, workspaceEntryValidator } from "../workspaceModel";
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

export const list = query({
  access: "access_lab",
  args: { threadId: v.string() },
  returns: v.object({
    configured: v.boolean(),
    cwd: v.string(),
    revision: v.number(),
    entries: v.array(workspaceEntryValidator),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceChat(ctx, args.threadId, ctx.viewer.userId);
    const workspace = await ctx.db
      .query("scoutWorkspaces")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();
    return {
      configured: workspaceStorageConfigured(),
      cwd: workspace?.cwd ?? WORKSPACE_ROOT,
      revision: workspace?.revision ?? 0,
      entries: workspace ? (await workspaceRows(ctx, workspace._id)).map((row) => row.entry) : [],
    };
  },
});

export const snapshot = internalMutation({
  args: { threadId: v.string(), userId: v.id("users") },
  returns: v.object({
    workspaceId: v.id("scoutWorkspaces"),
    cwd: v.string(),
    revision: v.number(),
    entries: v.array(workspaceEntryValidator),
  }),
  handler: async (ctx, args) => {
    await requireUserPermission(ctx, args.userId, "access_lab");
    await requireWorkspaceChat(ctx, args.threadId, args.userId);
    const workspace = await ctx.db
      .query("scoutWorkspaces")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (workspace)
      return {
        workspaceId: workspace._id,
        cwd: workspace.cwd,
        revision: workspace.revision,
        entries: (await workspaceRows(ctx, workspace._id)).map((row) => row.entry),
      };
    const workspaceId = await ctx.db.insert("scoutWorkspaces", {
      threadId: args.threadId,
      cwd: WORKSPACE_ROOT,
      revision: 0,
    });
    return { workspaceId, cwd: WORKSPACE_ROOT, revision: 0, entries: [] };
  },
});

export const commit = internalMutation({
  args: {
    workspaceId: v.id("scoutWorkspaces"),
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
  args: { threadId: v.string(), path: v.string() },
  returns: workspaceEntryValidator,
  handler: async (ctx, args) => {
    await requireWorkspaceChat(
      ctx,
      args.threadId,
      (await requirePermission(ctx, "access_lab")).userId,
    );
    const workspace = await ctx.db
      .query("scoutWorkspaces")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();
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
