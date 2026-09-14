import { siteHostnameSchema } from "../shared/site";
import { outdent } from "outdent";
import { v } from "convex/values";
import { z } from "zod";

export const WORKSPACE_ROOT = "/workspace";
export const MAX_WORKSPACE_ENTRIES = 200;
export const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;
export const MAX_WORKSPACE_BYTES = 5 * 1024 * 1024;
export const MAX_RUNTIME_ENTRIES = 1_000;
export const MAX_RUNTIME_PATH_LENGTH = 1_024;
export const MAX_RUNTIME_PATH_DEPTH = 32;
export const WORKSPACE_SHELL_TIMEOUT_MS = 15_000;
export const WORKSPACE_JS_TIMEOUT_MS = 5_000;

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

export const workspaceTargetValidator = v.union(
  v.object({ kind: v.literal("chat"), threadId: v.string() }),
  v.object({ kind: v.literal("site"), site: v.string() }),
);
export type WorkspaceTarget = typeof workspaceTargetValidator.type;

export const bashInputSchema = z.object({
  workspace: siteHostnameSchema.optional(),
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

export const BASH_DESCRIPTION = outdent`
  Run a just-bash command.

  Workspaces:

  - Omit workspace for this chat's private files, shown in the Workspace panel.
  - Set workspace to the site's exact hostname (for example papergames.io) to use files
    shared across users, Scouts, and chats for that site.
  - Keep private data, credentials, room links, and current task state in the private
    workspace. Shared files are fallible reference material; check against the current
    page and follow the user's request.
  - Each workspace has its own ${WORKSPACE_ROOT} directory and saved working directory;
    files in another workspace are not mounted. New workspaces start empty at ${WORKSPACE_ROOT}.

  Commands:

  - Supports shell scripts, pipes, redirects, common file/text/JSON commands, and
    js-exec script.ts (or script.js) for sandboxed JavaScript/TypeScript.
  - js-exec uses QuickJS, not full Node: standard JavaScript plus limited Node-compatible
    modules such as node:fs, node:path, node:assert, and Buffer.
  - File APIs use the virtual workspace. Relative imports of workspace files work.
  - TypeScript is stripped, not type-checked; use erasable syntax, not enums or parameter
    properties. For inline code use js-exec -c 'console.log(1 + 1)'.
  - No network, Python, npm packages or installation, native programs, host secrets,
    or background services.

  Persistence:

  - Everything outside ${WORKSPACE_ROOT} is temporary.
  - Shell variables and JavaScript state reset between calls.

  Limits per workspace:

  - ${MAX_WORKSPACE_ENTRIES} persisted entries.
  - ${MAX_RUNTIME_ENTRIES} runtime entries including temporary files and directories.
  - Path depth ${MAX_RUNTIME_PATH_DEPTH} and path/symlink-target length ${MAX_RUNTIME_PATH_LENGTH} characters.
  - ${MAX_WORKSPACE_FILE_BYTES / 1024} KiB per file, ${MAX_WORKSPACE_BYTES / (1024 * 1024)} MiB total.
  - ${WORKSPACE_SHELL_TIMEOUT_MS / 1000} seconds per shell command.
  - ${WORKSPACE_JS_TIMEOUT_MS / 1000} seconds and 64 MiB QuickJS memory per js-exec.

  Errors:

  - A nonzero exit code can still leave file changes, like a normal shell.
  - A storage or concurrency error means changes were not confirmed; inspect the
    workspace before retrying.
`;
