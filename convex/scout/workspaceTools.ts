"use node";

import { createHash, randomUUID } from "node:crypto";
import { tool } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { action } from "../functions";
import {
  BASH_DESCRIPTION,
  bashInputSchema,
  MAX_WORKSPACE_FILE_BYTES,
  type WorkspaceEntry,
} from "../workspaceModel";
import { workspaceFileKey, workspaceStorage } from "../workspaceStorage";
import { runWorkspaceShell } from "./workspaceShell";

async function readStoredFile(entry: Extract<WorkspaceEntry, { kind: "file" }>) {
  const response = await fetch(await workspaceStorage().getUrl(entry.key), {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Workspace file could not be read from R2 (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength > MAX_WORKSPACE_FILE_BYTES ||
    bytes.byteLength !== entry.size ||
    createHash("sha256").update(bytes).digest("hex") !== entry.sha256
  )
    throw new Error(`Workspace file failed its size or integrity check: ${entry.path}`);
  return bytes;
}

export function createWorkspaceTools(
  ctx: ActionCtx,
  scope: { threadId: string; userId: Id<"users"> },
  beforeDispatch: () => Promise<unknown>,
) {
  return {
    bash: tool({
      description: BASH_DESCRIPTION,
      inputSchema: bashInputSchema,
      execute: async ({ command }) => {
        await beforeDispatch();
        const storage = workspaceStorage();
        const snapshot = await ctx.runMutation(internal.scout.workspaces.snapshot, scope);
        const result = await runWorkspaceShell({
          command,
          cwd: snapshot.cwd,
          entries: snapshot.entries,
          readFile: readStoredFile,
        });
        const keys = new Map<string, string>();
        for (const write of result.writes) {
          const key = workspaceFileKey({ ...scope, uploadId: randomUUID(), path: write.path });
          await storage.store(ctx, write.bytes, {
            key,
            type: "application/octet-stream",
            disposition: `attachment; filename*=UTF-8''${encodeURIComponent(write.path.split("/").at(-1) ?? "file")}`,
          });
          keys.set(write.path, key);
        }
        const entries = result.entries.map((entry) => {
          if (entry.kind !== "file" || entry.key) return entry;
          const key = keys.get(entry.path);
          if (!key) throw new Error(`File upload was not confirmed: ${entry.path}`);
          return { ...entry, key };
        });
        const revision = await ctx.runMutation(internal.scout.workspaces.commit, {
          workspaceId: snapshot.workspaceId,
          userId: scope.userId,
          expectedRevision: snapshot.revision,
          cwd: result.output.cwd,
          entries,
        });
        return { ...result.output, revision };
      },
    }),
  };
}

const filePreviewValidator = v.object({
  path: v.string(),
  text: v.union(v.string(), v.null()),
  bytes: v.bytes(),
});

export const readFile = action({
  access: "access_lab",
  args: { threadId: v.string(), path: v.string() },
  returns: filePreviewValidator,
  handler: async (ctx, args): Promise<typeof filePreviewValidator.type> => {
    const entry: WorkspaceEntry = await ctx.runQuery(internal.scout.workspaces.fileForViewer, args);
    if (entry.kind !== "file") throw new Error("Select a regular file to preview");
    const bytes = await readStoredFile(entry);
    let text: string | null = null;
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!decoded.includes("\0")) text = decoded;
    } catch {
      // Non-UTF-8 files remain downloadable without lossy text conversion.
    }
    return { path: entry.path, text, bytes: bytes.buffer };
  },
});
