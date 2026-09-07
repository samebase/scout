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
  "Run a just-bash command in this chat's private workspace. Files and folders under /workspace persist between calls and are visible in the Workspace panel. The working directory starts at /workspace. Supports shell scripts, pipes, redirects, common file/text/JSON commands, and js-exec script.ts (or script.js) for sandboxed JavaScript/TypeScript. js-exec uses QuickJS, not full Node: standard JavaScript plus limited Node-compatible modules such as node:fs, node:path, node:assert, and Buffer. File APIs use the virtual workspace. Relative imports of workspace files work. TypeScript is stripped, not type-checked; use erasable syntax, not enums or parameter properties. For inline code use js-exec -c 'console.log(1 + 1)'. No network, Python, npm packages or installation, native programs, host secrets, or background services. Everything outside /workspace is temporary. Shell variables and JavaScript state reset between calls. Limits: 200 entries, 256 KiB per file, 5 MiB total, 15 seconds per shell command, 5 seconds and 64 MiB QuickJS memory per js-exec. A nonzero exit code can still leave file changes, like a normal shell. A storage or concurrency error means changes were not confirmed; inspect the workspace before retrying.";
