"use node";

import { createHash } from "node:crypto";
import { Bash, type BashOptions, type InitialFiles } from "just-bash";
import { WorkspaceFs } from "./workspaceFs";
import {
  MAX_WORKSPACE_BYTES,
  MAX_WORKSPACE_ENTRIES,
  MAX_WORKSPACE_FILE_BYTES,
  WORKSPACE_ROOT,
  type WorkspaceEntry,
} from "../workspaceModel";

const commands = [
  "cat",
  "head",
  "tail",
  "ls",
  "find",
  "tree",
  "mkdir",
  "rmdir",
  "touch",
  "rm",
  "cp",
  "mv",
  "ln",
  "readlink",
  "chmod",
  "stat",
  "file",
  "pwd",
  "echo",
  "printf",
  "env",
  "printenv",
  "basename",
  "dirname",
  "wc",
  "sort",
  "uniq",
  "cut",
  "tr",
  "paste",
  "join",
  "grep",
  "rg",
  "sed",
  "awk",
  "jq",
  "diff",
  "tee",
  "xargs",
  "seq",
  "date",
  "base64",
  "sha256sum",
  "md5sum",
  "true",
  "false",
  "which",
  "sleep",
  "timeout",
] satisfies NonNullable<BashOptions["commands"]>;

type FileEntry = Extract<WorkspaceEntry, { kind: "file" }>;

export async function runWorkspaceShell(args: {
  command: string;
  cwd: string;
  entries: WorkspaceEntry[];
  readFile: (entry: FileEntry) => Promise<Uint8Array>;
}) {
  const initialFiles: InitialFiles = {};
  let inputBytes = 0;
  for (const entry of args.entries) {
    if (entry.kind !== "file") continue;
    const bytes = await args.readFile(entry);
    inputBytes += bytes.byteLength;
    if (inputBytes > MAX_WORKSPACE_BYTES) throw new Error("Workspace size limit exceeded");
    initialFiles[entry.path] = { content: bytes, mode: entry.mode, mtime: new Date(entry.mtime) };
  }
  const fs = new WorkspaceFs(initialFiles, { maxTotalBytes: MAX_WORKSPACE_BYTES });
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  for (const entry of args.entries) {
    if (entry.kind === "directory") {
      await fs.mkdir(entry.path, { recursive: true });
      await fs.chmod(entry.path, entry.mode);
      await fs.utimes(entry.path, new Date(entry.mtime), new Date(entry.mtime));
    }
  }
  for (const entry of args.entries) {
    if (entry.kind === "symlink") await fs.symlink(entry.target, entry.path);
  }
  const bash = new Bash({
    fs,
    cwd: args.cwd,
    commands,
    javascript: true,
    executionLimitProfile: "hardened",
    executionLimits: {
      maxSourceBytes: 64 * 1024,
      maxExecutionTimeMs: 15_000,
      maxJsTimeoutMs: 5_000,
      maxOutputSize: 128 * 1024,
      maxFileSystemBytes: MAX_WORKSPACE_BYTES,
      maxLiveBytes: 16 * 1024 * 1024,
      maxStringLength: MAX_WORKSPACE_FILE_BYTES,
      maxHeredocSize: MAX_WORKSPACE_FILE_BYTES,
      maxLoopIterations: 10_000,
      maxCommandCount: 10_000,
      maxTraversalEntries: 2_000,
    },
  });
  const result = await bash.exec(args.command);
  const paths = fs
    .getAllPaths()
    .filter((path) => path === WORKSPACE_ROOT || path.startsWith(`${WORKSPACE_ROOT}/`))
    .sort();
  if (paths.length > MAX_WORKSPACE_ENTRIES) {
    throw new Error(`Workspace exceeds ${MAX_WORKSPACE_ENTRIES} entries. Changes were not saved.`);
  }
  const entries: WorkspaceEntry[] = [];
  const writes: { path: string; bytes: Uint8Array }[] = [];
  const previousFiles = new Map(args.entries.map((entry) => [entry.path, entry]));
  let totalBytes = 0;
  for (const path of paths) {
    const stat = await fs.lstat(path);
    if (path === WORKSPACE_ROOT && !stat.isDirectory)
      throw new Error("The workspace root must remain a directory. Changes were not saved.");
    if (stat.isSymbolicLink) {
      entries.push({ kind: "symlink", path, target: await fs.readlink(path) });
    } else if (stat.isDirectory) {
      entries.push({ kind: "directory", path, mode: stat.mode, mtime: stat.mtime.getTime() });
    } else {
      const bytes = await fs.readFileBuffer(path);
      totalBytes += bytes.byteLength;
      if (bytes.byteLength > MAX_WORKSPACE_FILE_BYTES || totalBytes > MAX_WORKSPACE_BYTES) {
        throw new Error(`Workspace size limit exceeded at ${path}. Changes were not saved.`);
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const previous = previousFiles.get(path);
      const key = previous?.kind === "file" && previous.sha256 === sha256 ? previous.key : "";
      entries.push({
        kind: "file",
        path,
        key,
        sha256,
        size: bytes.byteLength,
        mode: stat.mode,
        mtime: stat.mtime.getTime(),
      });
      if (!key) writes.push({ path, bytes });
    }
  }
  const requestedCwd = result.env["PWD"] ?? args.cwd;
  const nextCwd = (await fs.exists(requestedCwd))
    ? await fs.realpath(requestedCwd)
    : WORKSPACE_ROOT;
  const cwd = entries.some((entry) => entry.path === nextCwd && entry.kind === "directory")
    ? nextCwd
    : WORKSPACE_ROOT;
  return {
    entries,
    writes,
    output: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, cwd },
  };
}
