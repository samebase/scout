import { v } from "convex/values";
import { z } from "zod";

export const WORKSPACE_ROOT = "/workspace";
export const MAX_WORKSPACE_ENTRIES = 200;
export const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;
export const MAX_WORKSPACE_BYTES = 5 * 1024 * 1024;

export const workspaceFileValidator = v.object({
  kind: v.literal("file"),
  path: v.string(),
  key: v.string(),
  size: v.number(),
  sha256: v.string(),
  mode: v.number(),
  mtime: v.number(),
});

export const workspaceEntryValidator = v.union(
  workspaceFileValidator,
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

export const siteWorkspaceSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    "Use the site's exact hostname, such as papergames.io, without a URL path or port",
  );

export const bashInputSchema = z.object({
  workspace: siteWorkspaceSchema.optional(),
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
  "Run a just-bash command. Omit workspace for this chat's private files, shown in the Workspace panel. Set workspace to the site's exact hostname (for example papergames.io) to use files shared across users, Scouts, and chats for that site. Keep private data, credentials, room links, and current task state in the private workspace. Shared files are fallible reference material; check against the current page and follow the user's request. Each workspace has its own /workspace directory and saved working directory; files in another workspace are not mounted. New workspaces start empty at /workspace. Supports shell scripts, pipes, redirects, common file/text/JSON commands, and js-exec script.ts (or script.js) for sandboxed JavaScript/TypeScript. js-exec uses QuickJS, not full Node: standard JavaScript plus limited Node-compatible modules such as node:fs, node:path, node:assert, and Buffer. File APIs use the virtual workspace. Relative imports of workspace files work. TypeScript is stripped, not type-checked; use erasable syntax, not enums or parameter properties. For inline code use js-exec -c 'console.log(1 + 1)'. No network, Python, npm packages or installation, native programs, host secrets, or background services. Everything outside /workspace is temporary. Shell variables and JavaScript state reset between calls. Limits per workspace: 200 persisted entries, 1,000 runtime entries including temporary files and directories, path depth 32 and path/symlink-target length 1,024 characters, 256 KiB per file, 5 MiB total, 15 seconds per shell command, 5 seconds and 64 MiB QuickJS memory per js-exec. A nonzero exit code can still leave file changes, like a normal shell. A storage or concurrency error means changes were not confirmed; inspect the workspace before retrying.";
