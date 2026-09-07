import { describe, expect, it } from "vite-plus/test";
import {
  MAX_RUNTIME_ENTRIES,
  MAX_RUNTIME_PATH_DEPTH,
  MAX_RUNTIME_PATH_LENGTH,
  WorkspaceFs,
} from "./workspaceFs";

function fill(fs: WorkspaceFs, remaining = 0) {
  for (let i = fs.getAllPaths().length; i < MAX_RUNTIME_ENTRIES - remaining; i++)
    fs.writeFileSync(`/entry-${i}`, "");
}

describe("runtime filesystem metadata limits", () => {
  it.each([
    { name: "write", create: (fs: WorkspaceFs) => fs.writeFile("/new", "") },
    { name: "append", create: (fs: WorkspaceFs) => fs.appendFile("/new", "") },
    { name: "mkdir", create: (fs: WorkspaceFs) => fs.mkdir("/new") },
    { name: "copy", create: (fs: WorkspaceFs) => fs.cp("/source", "/new") },
    { name: "move", create: (fs: WorkspaceFs) => fs.mv("/source", "/new") },
    { name: "hard link", create: (fs: WorkspaceFs) => fs.link("/source", "/new") },
    { name: "symlink", create: (fs: WorkspaceFs) => fs.symlink("/source", "/new") },
  ])("refuses $name before exceeding the global entry limit", async ({ create }) => {
    const fs = new WorkspaceFs({ "/source": "saved" });
    fill(fs);
    await expect(create(fs)).rejects.toThrow("filesystem entry limit");
    expect(fs.getAllPaths()).toHaveLength(MAX_RUNTIME_ENTRIES);
    expect(await fs.exists("/new")).toBe(false);
    expect(await fs.readFile("/source")).toBe("saved");
  });

  it("counts implicit parents and temporary directories before creating them", () => {
    const fs = new WorkspaceFs();
    fill(fs, 2);
    expect(() => fs.writeFileSync("/tmp/parent/file", "")).toThrow("filesystem entry limit");
    expect(() => fs.mkdirSync("/tmp/parent/child", { recursive: true })).toThrow(
      "filesystem entry limit",
    );
    expect(() => fs.writeFileLazy("/tmp/parent/file", () => "")).toThrow("filesystem entry limit");
    expect(fs.getAllPaths()).toHaveLength(MAX_RUNTIME_ENTRIES - 2);
  });

  it("allows overwrites at capacity and reuses capacity after deletion", async () => {
    const fs = new WorkspaceFs({ "/source": "original" });
    fill(fs);
    await fs.writeFile("/source", "updated");
    await fs.appendFile("/source", "!");
    expect(await fs.readFile("/source")).toBe("updated!");
    await fs.rm("/source");
    await fs.mkdir("/replacement");
    expect(fs.getAllPaths()).toHaveLength(MAX_RUNTIME_ENTRIES);
  });

  it("counts the root itself if a script removed it", async () => {
    const fs = new WorkspaceFs();
    await fs.rm("/", { recursive: true });
    fill(fs);
    expect(() => fs.mkdirSync("/")).toThrow("filesystem entry limit");
    expect(() => fs.writeFileSync("/", "")).toThrow("filesystem entry limit");
    expect(fs.getAllPaths()).toHaveLength(MAX_RUNTIME_ENTRIES);
  });

  it.each(["copy", "move"])("checks recursive %s descendants", async (operation) => {
    const fs = new WorkspaceFs({ "/source/a": "a", "/source/b": "b" });
    fill(fs, 1);
    const result =
      operation === "copy"
        ? fs.cp("/source", "/destination", { recursive: true })
        : fs.mv("/source", "/destination");
    await expect(result).rejects.toThrow("filesystem entry limit");
    expect(fs.getAllPaths()).toHaveLength(MAX_RUNTIME_ENTRIES);
    expect(await fs.exists("/destination/a")).toBe(false);
  });

  it("bounds paths, implicit parent depth, and stored symlink targets", async () => {
    const fs = new WorkspaceFs();
    const deep = `/${"a/".repeat(MAX_RUNTIME_PATH_DEPTH + 1)}`;
    const long = `/${"x".repeat(MAX_RUNTIME_PATH_LENGTH)}`;
    expect(() => fs.mkdirSync(deep, { recursive: true })).toThrow("path depth limit");
    expect(() => fs.writeFileSync(deep, "")).toThrow("path depth limit");
    expect(() => fs.writeFileLazy(long, () => "")).toThrow("path limit");
    await expect(fs.symlink(long, "/link")).rejects.toThrow("symlink target limit");
    expect(fs.getAllPaths()).toEqual(["/"]);
    await fs.mkdir(`/${"a/".repeat(MAX_RUNTIME_PATH_DEPTH)}`, { recursive: true });
    expect(fs.getAllPaths()).toHaveLength(MAX_RUNTIME_PATH_DEPTH + 1);
  });

  it("does not overbook the last slot while hard links load a lazy source", async () => {
    const fs = new WorkspaceFs();
    fs.writeFileLazy("/source", async () => "saved");
    fill(fs, 1);
    const first = fs.link("/source", "/one");
    const second = fs.link("/source", "/two");
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(fs.getAllPaths()).toHaveLength(MAX_RUNTIME_ENTRIES);
  });
});
