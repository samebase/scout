import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { WORKSPACE_ROOT, type WorkspaceEntry } from "../workspaceModel";
import { runWorkspaceShell } from "./workspaceShell";

afterEach(() => vi.unstubAllEnvs());

function workspaceSession() {
  let entries: WorkspaceEntry[] = [];
  let cwd = WORKSPACE_ROOT;
  const blobs = new Map<string, Uint8Array>();
  return {
    entries: () => entries,
    run: async (command: string) => {
      const result = await runWorkspaceShell({
        command,
        cwd,
        entries,
        readFile: async (entry) => {
          const bytes = blobs.get(entry.key);
          if (!bytes) throw new Error("Blob missing");
          return bytes;
        },
      });
      const uploaded = new Map(
        result.writes.map((write) => {
          const key = crypto.randomUUID();
          blobs.set(key, write.bytes);
          return [write.path, key];
        }),
      );
      entries = result.entries.map((entry) => {
        if (entry.kind !== "file" || entry.key) return entry;
        const key = uploaded.get(entry.path);
        if (!key) throw new Error("Upload missing");
        return { ...entry, key };
      });
      cwd = result.output.cwd;
      return result;
    },
  };
}

describe("persistent just-bash workspace", () => {
  it("round trips text, an empty directory, cwd, and symlinks through fresh interpreters", async () => {
    const session = workspaceSession();
    expect(
      (
        await session.run(
          "mkdir -p reports/empty; cd reports; printf 'hello 世界\\n' > report.txt; ln -s report.txt latest",
        )
      ).output.exitCode,
    ).toBe(0);
    const result = await session.run("pwd; cat latest; test -d empty");
    expect(result.output).toMatchObject({
      exitCode: 0,
      stdout: "/workspace/reports\nhello 世界\n",
      cwd: "/workspace/reports",
    });
    expect(result.writes).toHaveLength(0);
  });

  it("persists append, folder rename, copy, and recursive deletion", async () => {
    const session = workspaceSession();
    await session.run("mkdir -p source; printf 'one\\n' > source/a.txt");
    await session.run(
      "printf 'two\\n' >> source/a.txt; mv source destination; cp -r destination copy; rm -rf destination",
    );
    expect((await session.run("cat copy/a.txt; test ! -e destination")).output).toMatchObject({
      exitCode: 0,
      stdout: "one\ntwo\n",
    });
    expect(session.entries().some((entry) => entry.path.startsWith("/workspace/source"))).toBe(
      false,
    );
  });

  it("keeps bytes unchanged and retains shell writes on a nonzero exit", async () => {
    const session = workspaceSession();
    const write = await session.run("printf /wAB | base64 -d > bytes.bin; false");
    expect(write.output.exitCode).toBe(1);
    expect((await session.run("base64 bytes.bin")).output.stdout.trim()).toBe("/wAB");
  });

  it("does not expose host secrets, host files, network, or Python", async () => {
    const session = workspaceSession();
    const result = await session.run(
      "printenv; cat /etc/passwd; curl https://example.com; python3 -c 'print(1)'",
    );
    expect(result.output.stdout).not.toContain("R2_SECRET_ACCESS_KEY");
    expect(result.output.stderr).toContain("curl: command not found");
    expect(result.output.stderr).toMatch(/python3: command not (found|available)/);
    expect(result.output.exitCode).toBe(127);
    expect(result.output.stderr).toContain("/etc/passwd");
    expect(session.entries().every((entry) => entry.path.startsWith(WORKSPACE_ROOT))).toBe(true);
  });

  it("runs erasable TypeScript with local imports and persists output across fresh interpreters", async () => {
    const session = workspaceSession();
    await session.run(`cat > sum.ts <<'TS'
export function sum<T extends { score: number }>(rows: T[]): number {
  return rows.reduce((total, row) => total + row.score, 0);
}
TS
cat > report.mts <<'TS'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strictEqual } from "node:assert";
import { sum } from "./sum.ts";
interface Row { name: string; score: number }
const rows: Row[] = JSON.parse(readFileSync("input.json", "utf8"));
const result = { total: sum(rows), count: rows.length } satisfies { total: number; count: number };
strictEqual(result.total, 17);
writeFileSync(join(process.cwd(), "output.json"), JSON.stringify(result));
console.log(Buffer.from("TS_OK").toString("utf8"));
TS
printf '[{"name":"Alpha","score":8},{"name":"Beta","score":9}]' > input.json`);
    expect((await session.run("js-exec report.mts")).output).toMatchObject({
      exitCode: 0,
      stdout: "TS_OK\n",
    });
    expect((await session.run("cat output.json")).output.stdout).toBe('{"total":17,"count":2}');
    expect(
      (
        await session.run(
          `js-exec -c 'console.log(JSON.parse(require("fs").readFileSync("output.json", "utf8")).total)'`,
        )
      ).output,
    ).toMatchObject({
      exitCode: 0,
      stdout: "17\n",
    });
  });

  it("keeps JavaScript file writes on errors but resets guest globals between executions", async () => {
    const session = workspaceSession();
    const failed = await session.run(
      `js-exec -c 'globalThis.privateValue = 42; require("fs").writeFileSync("saved.txt", "saved"); throw new Error("SCRIPT_FAILED")'`,
    );
    expect(failed.output.exitCode).not.toBe(0);
    expect(failed.output.stderr).toContain("SCRIPT_FAILED");
    expect(
      (await session.run(`cat saved.txt; js-exec -c 'console.log(typeof globalThis.privateValue)'`))
        .output,
    ).toMatchObject({
      exitCode: 0,
      stdout: "savedundefined\n",
    });
  });

  it("does not expose host secrets, host files, native processes, or network through JavaScript", async () => {
    vi.stubEnv("WORKSPACE_HOST_SECRET", "host-secret-sentinel");
    const session = workspaceSession();
    await session.run(`cat > boundaries.ts <<'TS'
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { strictEqual, throws } from "node:assert";
strictEqual(process.env.WORKSPACE_HOST_SECRET, undefined);
strictEqual(process.env.R2_SECRET_ACCESS_KEY, undefined);
throws(() => readFileSync("/etc/passwd", "utf8"));
throws(() => readFileSync("/proc/self/environ", "utf8"));
throws(() => execSync("/bin/sh -c 'echo native'"));
throws(() => execSync("curl https://example.com"));
let networkDenied = false;
try { await fetch("https://example.com"); } catch { networkDenied = true; }
strictEqual(networkDenied, true);
console.log("BOUNDARIES_OK");
TS`);
    expect((await session.run("js-exec boundaries.ts")).output).toMatchObject({
      exitCode: 0,
      stdout: "BOUNDARIES_OK\n",
    });
  });

  it("rejects npm packages, unsupported Node modules, and non-erasable TypeScript", async () => {
    const session = workspaceSession();
    const npm = await session.run("npm --version");
    expect(npm.output.exitCode).toBe(127);
    for (const module of ["clsx", "node:net", "node:worker_threads"]) {
      const result = await session.run(`js-exec -m -c 'import "${module}"'`);
      expect(result.output.exitCode).not.toBe(0);
      expect(result.output.stderr).toContain(module.replace(/^node:/, ""));
    }
    await session.run("printf 'enum Status { Ready, Done }' > enum.ts");
    const result = await session.run("js-exec enum.ts");
    expect(result.output.exitCode).not.toBe(0);
    expect(result.output.stderr).toContain("strip-only mode");
  });

  it("enforces file limits for JavaScript writes without replacing the saved workspace", async () => {
    const session = workspaceSession();
    await session.run("printf original > report.txt");
    await expect(
      session.run(
        `js-exec -c 'require("fs").writeFileSync("large.txt", "x".repeat(256 * 1024 + 1))'`,
      ),
    ).rejects.toThrow("size limit");
    expect((await session.run("cat report.txt; test ! -e large.txt")).output).toMatchObject({
      exitCode: 0,
      stdout: "original",
    });
  });

  it("interrupts runaway JavaScript and allows the next command to run", async () => {
    const session = workspaceSession();
    const result = await session.run("js-exec -c 'while (true) {}'");
    expect(result.output.exitCode).not.toBe(0);
    expect(result.output.stderr).toMatch(/interrupt|timed?\s*out/i);
    expect((await session.run("js-exec -c 'console.log(42)'")).output).toMatchObject({
      exitCode: 0,
      stdout: "42\n",
    });
  }, 12_000);

  it("bounds QuickJS memory and isolates concurrently submitted workspaces", async () => {
    const session = workspaceSession();
    const result = await session.run(
      "js-exec -c 'const allocations = []; while (true) allocations.push(new Array(100000).fill(42))'",
    );
    expect(result.output.exitCode).not.toBe(0);
    expect(result.output.stderr).toMatch(/out of memory/i);
    const other = workspaceSession();
    await session.run("printf first > private.txt");
    await other.run("printf second > private.txt");
    const command = `js-exec -c 'console.log(require("fs").readFileSync("private.txt", "utf8"))'`;
    const results = await Promise.all([session.run(command), other.run(command)]);
    expect(results.map((entry) => entry.output)).toMatchObject([
      { exitCode: 0, stdout: "first\n" },
      { exitCode: 0, stdout: "second\n" },
    ]);
  });

  it("rejects oversized snapshots without replacing the saved workspace", async () => {
    const session = workspaceSession();
    await session.run("printf original > report.txt");
    await expect(session.run("seq 1 201 | xargs touch")).rejects.toThrow("entries");
    expect((await session.run("cat report.txt")).output.stdout).toBe("original");
  });

  it("rejects replacing the root with a file or symlink without poisoning later commands", async () => {
    const session = workspaceSession();
    await session.run("printf original > report.txt");
    await expect(session.run("cd /; rm -rf /workspace; touch /workspace")).rejects.toThrow(
      "root must remain a directory",
    );
    await expect(session.run("cd /; rm -rf /workspace; ln -s /tmp /workspace")).rejects.toThrow(
      "root must remain a directory",
    );
    expect((await session.run("cat report.txt")).output.stdout).toBe("original");
  });
});
