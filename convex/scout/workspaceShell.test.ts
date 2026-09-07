import { describe, expect, it } from "vite-plus/test";
import { WORKSPACE_ROOT, type WorkspaceEntry } from "../workspaceModel";
import { runWorkspaceShell } from "./workspaceShell";

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
