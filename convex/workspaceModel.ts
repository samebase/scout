import { v } from "convex/values";
import { z } from "zod";

export const WORKSPACE_ROOT = "/workspace";
export const MAX_WORKSPACE_ENTRIES = 200;
export const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;
export const MAX_WORKSPACE_BYTES = 5 * 1024 * 1024;

export const workspaceEntryValidator = v.union(
  v.object({
    kind: v.literal("file"),
    path: v.string(),
    key: v.string(),
    size: v.number(),
    sha256: v.string(),
    mode: v.number(),
    mtime: v.number(),
  }),
  v.object({
    kind: v.literal("directory"),
    path: v.string(),
    mode: v.number(),
    mtime: v.number(),
  }),
  v.object({
    kind: v.literal("symlink"),
    path: v.string(),
    target: v.string(),
  }),
);

export type WorkspaceEntry = typeof workspaceEntryValidator.type;

export const bashInputSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(64 * 1024),
});
export const bashResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  cwd: z.string(),
  revision: z.number(),
});

export const BASH_DESCRIPTION =
  "Run a just-bash command in this chat's private workspace. Files and folders under /workspace persist between calls and are visible in the Workspace panel. The working directory starts at /workspace. Supports shell scripts, pipes, redirects, and common file/text/JSON commands. This is an in-memory shell, not a Linux machine: no network, Python, Node, npm, native programs, or background processes. Everything outside /workspace is temporary. Shell variables reset between calls. Limits: 200 entries, 256 KiB per file, 5 MiB total, 15 seconds per command. A nonzero shell exit code can still leave file changes, like a normal shell. A storage or concurrency error means changes were not confirmed; inspect the workspace before retrying.";
