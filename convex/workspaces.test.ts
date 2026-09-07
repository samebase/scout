/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { R2 } from "@convex-dev/r2";
import { tool } from "ai";
import { z } from "zod";
import { convexTest } from "convex-test";
import { Firecrawl } from "firecrawl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
import schema from "./schema";
import {
  bashResultSchema,
  MAX_WORKSPACE_BYTES,
  MAX_WORKSPACE_ENTRIES,
  MAX_WORKSPACE_FILE_BYTES,
  type WorkspaceEntry,
} from "./workspaceModel";
import {
  INLINE_TOOL_RESULT_BYTES,
  saveToolResult,
  withWorkspaceResults,
} from "./scout/toolResults";
import { requireRuntimeTool } from "./scout/lib/runtimeTool";
import { createWorkspaceTools } from "./scout/workspaceTools";
import { createWebTools } from "./scout/webTools";

const modules = import.meta.glob("./**/*.ts");
const blobs = new Map<string, Uint8Array>();
const deleted: string[] = [];
const scrape = vi.fn<Firecrawl["scrape"]>();

beforeEach(() => {
  blobs.clear();
  deleted.length = 0;
  vi.stubEnv("R2_BUCKET", "workspace-test");
  vi.stubEnv("R2_ENDPOINT", "https://storage.example.test");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://workspace-test.convex.cloud");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  scrape.mockReset().mockResolvedValue({ markdown: "A small page." });
  vi.spyOn(Firecrawl.prototype, "scrape").mockImplementation(scrape);
  vi.spyOn(R2.prototype, "store").mockImplementation(async (_ctx, file, options) => {
    const key = typeof options === "string" ? options : options?.key;
    if (!key) throw new Error("Expected an explicitly scoped key");
    blobs.set(key, file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file);
    return key;
  });
  vi.spyOn(R2.prototype, "getUrl").mockImplementation(
    async (key) => `https://storage.example.test/${key}`,
  );
  vi.spyOn(R2.prototype, "deleteObject").mockImplementation(async (_ctx, key) => {
    deleted.push(key);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const bytes = blobs.get(url.pathname.slice(1));
      return bytes
        ? new Response(new Uint8Array(bytes), { status: 200 })
        : new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  const userId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
  const otherId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
  const scoutId = await backend.run((ctx) =>
    ctx.db.insert("scouts", {
      displayName: "Workspace Scout",
      websiteIdentity: { firstName: "Workspace", lastName: "Scout" },
      slug: "workspace",
      status: "active",
      agentMail: { inboxId: "test-inbox", address: "scout@example.test" },
      firecrawl: { profileName: "workspace-profile" },
    }),
  );
  const owner = backend.withIdentity({ subject: `${userId}|session` });
  const other = backend.withIdentity({ subject: `${otherId}|session` });
  const { threadId } = await owner.mutation(api.scout.chats.createThread, { scoutId });
  const otherThread = await other.mutation(api.scout.chats.createThread, { scoutId });
  const run = async (command: string) =>
    owner.action(api.scout.manual.executeTool, {
      threadId,
      toolName: "bash",
      input: JSON.stringify({ command }),
      operationId: crypto.randomUUID(),
    });
  const read = (url = "https://example.com/docs/billing") =>
    owner.action(api.scout.manual.executeTool, {
      threadId,
      toolName: "web_read",
      input: JSON.stringify({ url }),
      operationId: crypto.randomUUID(),
    });
  const readAsAgent = (url = "https://example.com/docs/billing") =>
    owner.action(async (ctx) => {
      const tool = createWebTools(ctx, { threadId, userId }).web_read;
      if (!tool.execute) throw new Error("web_read has no executor");
      return tool.execute({ url }, { toolCallId: crypto.randomUUID(), messages: [], context: {} });
    });
  return {
    backend,
    owner,
    other,
    userId,
    otherId,
    threadId,
    otherThreadId: otherThread.threadId,
    run,
    read,
    readAsAgent,
  };
}

describe("workspace persistence and access", () => {
  it("writes under owner/thread prefixes and reloads files through the manual tool and viewer", async () => {
    const { owner, userId, threadId, run } = await setup();
    const first = await run("mkdir -p reports; cd reports; printf 'hello\\n' > hello.txt");
    expect(first.outcome.kind).toBe("success");
    const workspace = await owner.query(api.scout.workspaces.list, { threadId });
    expect(workspace.cwd).toBe("/workspace/reports");
    expect(workspace.entries.find((entry) => entry.kind === "file")).toMatchObject({
      key: expect.stringContaining(`/users/${userId}/threads/${threadId}/files/`),
    });
    expect([...blobs.keys()][0]).toMatch(/\/files\/reports\/hello\.txt\/[a-f0-9-]{36}$/);
    const preview = await owner.action(api.scout.workspaceTools.readFile, {
      threadId,
      path: "/workspace/reports/hello.txt",
    });
    expect(preview.text).toBe("hello\n");
    expect(new Uint8Array(preview.bytes)).toEqual(new TextEncoder().encode("hello\n"));
    expect(preview).not.toHaveProperty("url");
    const second = await run("cat hello.txt");
    if (second.outcome.kind !== "success") throw new Error(second.outcome.error);
    expect(bashResultSchema.parse(JSON.parse(second.outcome.output))).toMatchObject({
      stdout: "hello\n",
      revision: 1,
    });
    expect(blobs.size).toBe(1);
  });

  it("refuses other users and anonymous callers, even when Scouts are shared", async () => {
    const { backend, owner, other, threadId, otherThreadId, run } = await setup();
    await run("printf private > secret.txt");
    await expect(other.query(api.scout.workspaces.list, { threadId })).rejects.toThrow(
      "Chat not found",
    );
    await expect(backend.query(api.scout.workspaces.list, { threadId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      other.action(api.scout.workspaceTools.readFile, { threadId, path: "/workspace/secret.txt" }),
    ).rejects.toThrow("Chat not found");
    await expect(
      other.action(api.scout.manual.executeTool, {
        threadId,
        toolName: "bash",
        input: '{"command":"cat secret.txt"}',
        operationId: "other-user",
      }),
    ).rejects.toThrow("Thread not found");
    expect(
      (await other.query(api.scout.workspaces.list, { threadId: otherThreadId })).entries,
    ).toEqual([]);
    await expect(
      owner.query(api.scout.workspaces.list, { threadId: otherThreadId }),
    ).rejects.toThrow("Chat not found");
  });

  it("persists TypeScript-generated files in R2 and keeps them private to their chat owner", async () => {
    const { owner, other, backend, threadId, userId, run } = await setup();
    const result = await run(`cat > report.ts <<'TS'
import { writeFileSync } from "node:fs";
const scores: number[] = [8, 9];
writeFileSync("/workspace/report.json", JSON.stringify({ total: scores.reduce((a, b) => a + b, 0) }));
TS
js-exec report.ts`);
    if (result.outcome.kind !== "success") throw new Error(result.outcome.error);
    expect(bashResultSchema.parse(JSON.parse(result.outcome.output)).exitCode).toBe(0);
    expect([...blobs.keys()]).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^deployments/workspace-test\\.convex\\.cloud/users/${userId}/threads/${threadId}/files/report\\.json/[a-f0-9-]{36}$`,
        ),
      ),
    );
    expect(
      await owner.action(api.scout.workspaceTools.readFile, {
        threadId,
        path: "/workspace/report.json",
      }),
    ).toMatchObject({ text: '{"total":17}' });
    const reloaded = await run(
      `js-exec -c 'console.log(require("fs").readFileSync("report.json", "utf8"))'`,
    );
    if (reloaded.outcome.kind !== "success") throw new Error(reloaded.outcome.error);
    expect(bashResultSchema.parse(JSON.parse(reloaded.outcome.output))).toMatchObject({
      exitCode: 0,
      stdout: '{"total":17}\n',
    });
    await expect(
      other.action(api.scout.workspaceTools.readFile, {
        threadId,
        path: "/workspace/report.json",
      }),
    ).rejects.toThrow("Chat not found");
    for (const caller of [other, backend]) {
      await expect(
        caller.action(api.scout.manual.executeTool, {
          threadId,
          toolName: "bash",
          input: JSON.stringify({ command: "js-exec report.ts" }),
          operationId: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/Thread not found|Not authorized/);
    }
  });

  it("keeps the prior files and revision when R2 refuses a write", async () => {
    const { owner, threadId, run } = await setup();
    await run("printf original > report.txt");
    const before = await owner.query(api.scout.workspaces.list, { threadId });
    vi.spyOn(R2.prototype, "store").mockRejectedValueOnce(new Error("R2 write failed"));
    expect((await run("printf changed > report.txt")).outcome).toMatchObject({
      kind: "error",
      error: expect.stringContaining("R2 write failed"),
    });
    expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(before);
    expect(
      (
        await owner.action(api.scout.workspaceTools.readFile, {
          threadId,
          path: "/workspace/report.txt",
        })
      ).text,
    ).toBe("original");
    expect(deleted).toEqual([]);
  });

  it("preserves the workspace when lab access is revoked during a Bash upload", async () => {
    const { backend, owner, userId, threadId, run } = await setup();
    await run("printf original > report.txt; printf keep > keep.txt");
    const before = await owner.query(api.scout.workspaces.list, { threadId });
    vi.spyOn(R2.prototype, "store").mockImplementationOnce(async (_ctx, file, options) => {
      const key = typeof options === "string" ? options : options?.key;
      if (!key) throw new Error("Expected an explicitly scoped key");
      blobs.set(key, file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file);
      await backend.run((ctx) =>
        ctx.db.patch(userId, { email: "member@example.test", isApproved: true }),
      );
      return key;
    });
    expect(
      (await run("printf replacement > report.txt; rm keep.txt; mkdir reports; cd reports"))
        .outcome,
    ).toMatchObject({ kind: "error", error: expect.stringContaining("Not authorized") });
    await backend.run((ctx) => ctx.db.patch(userId, { email: ADMIN_EMAIL }));
    expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(before);
    expect(
      await owner.action(api.scout.workspaceTools.readFile, {
        threadId,
        path: "/workspace/report.txt",
      }),
    ).toMatchObject({ text: "original" });
    expect(deleted).toEqual([]);
  });

  it("preserves the workspace when chat ownership changes during a Bash upload", async () => {
    const { backend, owner, other, otherId, threadId, run } = await setup();
    await run("printf original > report.txt; printf keep > keep.txt");
    const before = await owner.query(api.scout.workspaces.list, { threadId });
    vi.spyOn(R2.prototype, "store").mockImplementationOnce(async (_ctx, file, options) => {
      const key = typeof options === "string" ? options : options?.key;
      if (!key) throw new Error("Expected an explicitly scoped key");
      blobs.set(key, file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file);
      await backend.run(async (ctx) => {
        const chat = await ctx.db
          .query("scoutChats")
          .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
          .unique();
        if (!chat) throw new Error("Expected the owner's chat");
        await ctx.db.patch(chat._id, { userId: otherId });
      });
      return key;
    });
    expect(
      (await run("printf replacement > report.txt; rm keep.txt; mkdir reports; cd reports"))
        .outcome,
    ).toMatchObject({ kind: "error", error: expect.stringContaining("Chat not found") });
    expect(await other.query(api.scout.workspaces.list, { threadId })).toEqual(before);
    expect(
      await other.action(api.scout.workspaceTools.readFile, {
        threadId,
        path: "/workspace/report.txt",
      }),
    ).toMatchObject({ text: "original" });
    expect(deleted).toEqual([]);
  });

  it.each(["member", "unverified", "deleted"])(
    "denies existing workspace access when its owner becomes %s",
    async (state) => {
      const { backend, owner, userId, threadId, run } = await setup();
      await run("printf private > secret.txt");
      await backend.run(async (ctx) => {
        if (state === "member") {
          await ctx.db.patch(userId, { email: "member@example.test", isApproved: true });
        } else if (state === "unverified") {
          await ctx.db.patch(userId, { emailVerificationTime: undefined });
        } else {
          await ctx.db.replace(userId, { state: "deleted", deletedAt: Date.now() });
        }
      });
      await expect(owner.query(api.scout.workspaces.list, { threadId })).rejects.toThrow(
        "Not authorized",
      );
      await expect(
        owner.action(api.scout.workspaceTools.readFile, {
          threadId,
          path: "/workspace/secret.txt",
        }),
      ).rejects.toThrow("Not authorized");
      await expect(
        backend.mutation(internal.scout.workspaces.snapshot, { threadId, userId }),
      ).rejects.toThrow("Not authorized");
      await expect(run("cat secret.txt")).rejects.toThrow("Not authorized");
    },
  );

  it("rejects a stale commit and schedules cleanup only after a successful replacement", async () => {
    const { backend, owner, threadId, userId, run } = await setup();
    await run("printf original > report.txt");
    const stale = await backend.mutation(internal.scout.workspaces.snapshot, { threadId, userId });
    await run("printf replacement > report.txt");
    const current = await owner.query(api.scout.workspaces.list, { threadId });
    const originalFile = stale.entries.find((entry) => entry.kind === "file");
    const replacementFile = current.entries.find((entry) => entry.kind === "file");
    if (originalFile?.kind !== "file" || replacementFile?.kind !== "file")
      throw new Error("Expected both saved file versions");
    expect(originalFile.key).toMatch(/\/files\/report\.txt\/[a-f0-9-]{36}$/);
    expect(replacementFile.key).toMatch(/\/files\/report\.txt\/[a-f0-9-]{36}$/);
    expect(replacementFile.key).not.toBe(originalFile.key);
    await expect(
      backend.mutation(internal.scout.workspaces.commit, {
        workspaceId: stale.workspaceId,
        userId,
        expectedRevision: stale.revision,
        entries: stale.entries,
        cwd: stale.cwd,
      }),
    ).rejects.toThrow("Another command");
    expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(current);
    expect(deleted).toEqual([originalFile.key]);
    await run("rm report.txt");
    expect(deleted).toEqual([originalFile.key, replacementFile.key]);
  });

  it("returns exact binary bytes for download without a text preview", async () => {
    const { owner, threadId, run } = await setup();
    await run("printf /wAB | base64 -d > bytes.bin");
    const file = await owner.action(api.scout.workspaceTools.readFile, {
      threadId,
      path: "/workspace/bytes.bin",
    });
    expect(file.text).toBeNull();
    expect(new Uint8Array(file.bytes)).toEqual(new Uint8Array([255, 0, 1]));
  });

  it.each(["corrupt", "modified"])(
    "rejects missing or corrupt bytes in both shell and preview reads: %s",
    async (corrupted) => {
      const { owner, threadId, run } = await setup();
      await run("printf original > report.txt");
      const before = await owner.query(api.scout.workspaces.list, { threadId });
      for (const key of blobs.keys()) blobs.set(key, new TextEncoder().encode(corrupted));
      await expect(
        owner.action(api.scout.workspaceTools.readFile, {
          threadId,
          path: "/workspace/report.txt",
        }),
      ).rejects.toThrow("integrity");
      expect((await run("cat report.txt")).outcome).toMatchObject({
        kind: "error",
        error: expect.stringContaining("integrity"),
      });
      blobs.clear();
      await expect(
        owner.action(api.scout.workspaceTools.readFile, {
          threadId,
          path: "/workspace/report.txt",
        }),
      ).rejects.toThrow("404");
      expect((await run("cat report.txt")).outcome).toMatchObject({
        kind: "error",
        error: expect.stringContaining("404"),
      });
      expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(before);
    },
  );
});

describe("web reads saved to the workspace", () => {
  it("saves the complete page, returns only an excerpt, and lets Bash find an answer past 20,000 characters", async () => {
    const { owner, other, threadId, userId, read, run } = await setup();
    const markdown = `${"Introduction\n".repeat(2_000)}\nThe secret answer is 42.\n`;
    scrape.mockResolvedValue({
      markdown,
      metadata: { title: "Billing", sourceURL: "https://redirect.example/actual", creditsUsed: 1 },
    });
    const requestedUrl = "https://example.com/docs/billing?plan=pro#price";
    const result = await read(requestedUrl);
    if (result.outcome.kind !== "success") throw new Error(result.outcome.error);
    expect(JSON.parse(result.outcome.output)).toMatchObject({
      requestedUrl,
      sourceUrl: "https://redirect.example/actual",
      title: "Billing",
      excerpt: markdown.slice(0, 2_000),
      excerptTruncated: true,
      creditsUsed: 1,
    });
    expect(result.outcome.output).not.toContain("The secret answer");
    expect(result.outcome.output.length).toBeLessThan(3_000);
    const { entries } = await owner.query(api.scout.workspaces.list, { threadId });
    expect(
      entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path),
    ).toEqual(["/workspace", "/workspace/sources", "/workspace/sources/example.com"]);
    const file = entries.find((entry) => entry.kind === "file");
    if (!file || file.kind !== "file") throw new Error("Source file not registered");
    expect(file.path).toMatch(/^\/workspace\/sources\/example\.com\/docs-billing-[a-f0-9]{8}\.md$/);
    expect(file.key).toMatch(
      new RegExp(
        `^deployments/workspace-test\\.convex\\.cloud/users/${userId}/threads/${threadId}/files/sources/example\\.com/docs-billing-[a-f0-9]{8}\\.md/[a-f0-9-]{36}$`,
      ),
    );
    expect(file.path).not.toMatch(/plan|price|redirect/);
    const preview = await owner.action(api.scout.workspaceTools.readFile, {
      threadId,
      path: file.path,
    });
    expect(preview.text).toContain(`requestedUrl: ${JSON.stringify(requestedUrl)}`);
    expect(preview.text).toContain('sourceUrl: "https://redirect.example/actual"');
    expect(preview.text).toMatch(/retrievedAt: "\d{4}-\d{2}-\d{2}T/);
    expect(preview.text?.endsWith(markdown)).toBe(true);
    expect(preview.bytes.byteLength).toBe(file.size);
    expect(JSON.parse(result.outcome.output)).toMatchObject({
      path: file.path,
      byteCount: file.size,
    });
    const searched = await run(`rg -n 'secret answer' '${file.path}'`);
    if (searched.outcome.kind !== "success") throw new Error(searched.outcome.error);
    expect(bashResultSchema.parse(JSON.parse(searched.outcome.output)).stdout).toContain(
      "The secret answer is 42.",
    );
    await expect(
      other.action(api.scout.workspaceTools.readFile, { threadId, path: file.path }),
    ).rejects.toThrow("Chat not found");
    await expect(
      other.action(api.scout.manual.executeTool, {
        threadId,
        toolName: "web_read",
        input: JSON.stringify({ url: requestedUrl }),
        operationId: "other-read",
      }),
    ).rejects.toThrow("Thread not found");
    expect(scrape).toHaveBeenCalledExactlyOnceWith(requestedUrl, {
      formats: ["markdown"],
      onlyMainContent: true,
      removeBase64Images: true,
      timeout: 60_000,
      autoResume: false,
    });
  });

  it("keeps parallel agent reads and repeated URLs as separate files without invalidating cwd", async () => {
    const { owner, threadId, readAsAgent, run } = await setup();
    await run("mkdir reports; cd reports");
    const results = await Promise.all([readAsAgent(), readAsAgent()]);
    expect(results[0]).toMatchObject({ excerpt: "A small page.", excerptTruncated: false });
    const current = await owner.query(api.scout.workspaces.list, { threadId });
    expect(current.cwd).toBe("/workspace/reports");
    expect(current.revision).toBe(3);
    const files = current.entries.filter((entry) => entry.kind === "file");
    expect(files).toHaveLength(2);
    expect(new Set(files.map((entry) => entry.path)).size).toBe(2);
    expect(new Set(files.map((entry) => entry.key)).size).toBe(2);
  });

  it.each([
    ["https://example.com/", "index"],
    ["https://example.com/Docs/Billing", "docs-billing"],
    [`https://example.com/${"a".repeat(300)}`, "a".repeat(80)],
    ["https://example.com/%2e%2e/%2Freport", "2freport"],
  ])("uses a bounded safe requested-URL filename for %s", async (url, slug) => {
    const { readAsAgent } = await setup();
    expect(await readAsAgent(url)).toMatchObject({
      path: expect.stringMatching(
        new RegExp(`^/workspace/sources/example\\.com/${slug}-[a-f0-9]{8}\\.md$`),
      ),
    });
  });

  it("keeps Unicode code points intact at the excerpt boundary", async () => {
    const { readAsAgent } = await setup();
    const excerpt = `${"a".repeat(1_999)}🚀`;
    scrape.mockResolvedValue({ markdown: `${excerpt}More content` });
    expect(await readAsAgent()).toMatchObject({ excerpt, excerptTruncated: true });
  });

  it("prevents stale Bash snapshots from deleting a newer imported file", async () => {
    const { backend, owner, threadId, userId, readAsAgent } = await setup();
    const stale = await backend.mutation(internal.scout.workspaces.snapshot, { threadId, userId });
    await readAsAgent();
    const current = await owner.query(api.scout.workspaces.list, { threadId });
    await expect(
      backend.mutation(internal.scout.workspaces.commit, {
        workspaceId: stale.workspaceId,
        userId,
        expectedRevision: stale.revision,
        entries: stale.entries,
        cwd: stale.cwd,
      }),
    ).rejects.toThrow("Another command");
    expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(current);
  });

  it.each([
    "touch sources",
    "mkdir elsewhere; ln -s elsewhere sources",
    "mkdir sources; touch sources/example.com",
    "mkdir sources elsewhere; ln -s /workspace/elsewhere sources/example.com",
  ])("refuses file or symlink ancestors without changing the workspace: %s", async (command) => {
    const { owner, threadId, run, read } = await setup();
    await run(command);
    const before = await owner.query(api.scout.workspaces.list, { threadId });
    expect((await read()).outcome).toMatchObject({
      kind: "error",
      error: expect.stringContaining("parent is not a directory"),
    });
    expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(before);
  });

  it("enforces UTF-8 bytes including provenance at the exact per-file boundary", async () => {
    const { owner, threadId, read } = await setup();
    scrape.mockResolvedValue({ markdown: "a" });
    await read();
    const initial = await owner.query(api.scout.workspaces.list, { threadId });
    const file = initial.entries.find((entry) => entry.kind === "file");
    if (!file || file.kind !== "file") throw new Error("Missing source");
    const remaining = MAX_WORKSPACE_FILE_BYTES - (file.size - 1);
    const markdown = "é".repeat(Math.floor(remaining / 2)) + "a".repeat(remaining % 2);
    scrape.mockResolvedValue({ markdown });
    expect((await read()).outcome.kind).toBe("success");
    const before = await owner.query(api.scout.workspaces.list, { threadId });
    expect(before.entries).toContainEqual(
      expect.objectContaining({ size: MAX_WORKSPACE_FILE_BYTES }),
    );
    scrape.mockResolvedValue({ markdown: `${markdown}a` });
    expect((await read()).outcome).toMatchObject({
      kind: "error",
      error: expect.stringContaining("Page is too large"),
    });
    expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(before);
    expect(blobs.size).toBe(2);
  });

  it("fails before fetching if R2 configuration or chat ownership is missing", async () => {
    const { owner, userId, threadId, otherThreadId, readAsAgent } = await setup();
    await expect(
      owner.action(async (ctx) =>
        createWebTools(ctx, { threadId: otherThreadId, userId }).web_read.execute?.(
          { url: "https://example.com" },
          { toolCallId: "wrong-scope", messages: [], context: {} },
        ),
      ),
    ).rejects.toThrow("Chat not found");
    vi.stubEnv("R2_BUCKET", "");
    await expect(readAsAgent()).rejects.toThrow("Workspace storage is not configured");
    expect(scrape).not.toHaveBeenCalled();
    expect((await owner.query(api.scout.workspaces.list, { threadId })).entries).toEqual([]);
  });

  it("does not claim success for a provider, missing Markdown, or upload failure", async () => {
    const { owner, threadId, read } = await setup();
    scrape.mockRejectedValueOnce(new Error("Page unavailable"));
    expect((await read()).outcome).toMatchObject({
      kind: "error",
      error: expect.stringContaining("Page unavailable"),
    });
    scrape.mockResolvedValueOnce({});
    expect((await read()).outcome.kind).toBe("error");
    vi.spyOn(R2.prototype, "store").mockRejectedValueOnce(new Error("R2 write failed"));
    expect((await read()).outcome).toMatchObject({
      kind: "error",
      error: expect.stringContaining("R2 write failed"),
    });
    expect((await owner.query(api.scout.workspaces.list, { threadId })).entries).toEqual([]);
    expect(blobs.size).toBe(0);
  });

  it("rechecks authorization during registration if access is revoked while fetching", async () => {
    const { backend, owner, userId, threadId, read } = await setup();
    scrape.mockImplementationOnce(async () => {
      await backend.run((ctx) => ctx.db.patch(userId, { emailVerificationTime: undefined }));
      return { markdown: "Fetched after access changed" };
    });
    expect((await read()).outcome).toMatchObject({
      kind: "error",
      error: expect.stringContaining("Not authorized"),
    });
    await backend.run((ctx) => ctx.db.patch(userId, { emailVerificationTime: Date.now() }));
    expect((await owner.query(api.scout.workspaces.list, { threadId })).entries).toEqual([]);
  });

  it("rejects occupied destinations of every kind and paths outside the workspace", async () => {
    const { backend, owner, userId, threadId } = await setup();
    const snapshot = await backend.mutation(internal.scout.workspaces.snapshot, {
      threadId,
      userId,
    });
    const file = {
      kind: "file",
      path: "/workspace/source.md",
      key: "test",
      size: 1,
      sha256: "test",
      mode: 0o644,
      mtime: 0,
    } satisfies WorkspaceEntry;
    for (const existing of [
      file,
      { kind: "directory", path: file.path, mode: 0o755, mtime: 0 },
      { kind: "symlink", path: file.path, target: "/workspace/elsewhere" },
    ] satisfies WorkspaceEntry[]) {
      const id = await backend.run((ctx) =>
        ctx.db.insert("scoutWorkspaceFiles", {
          workspaceId: snapshot.workspaceId,
          entry: existing,
        }),
      );
      await expect(
        backend.mutation(internal.scout.workspaces.addFile, {
          workspaceId: snapshot.workspaceId,
          userId,
          entry: file,
        }),
      ).rejects.toThrow("already exists");
      await backend.run((ctx) => ctx.db.delete(id));
    }
    for (const path of [
      "/outside/source.md",
      "/workspace/../escape",
      "/workspace//source",
      "/workspace/sources/./source",
      "/workspace/sources\\source",
    ]) {
      await expect(
        backend.mutation(internal.scout.workspaces.addFile, {
          workspaceId: snapshot.workspaceId,
          userId,
          entry: { ...file, path },
        }),
      ).rejects.toThrow("absolute path inside /workspace");
    }
    expect((await owner.query(api.scout.workspaces.list, { threadId })).revision).toBe(0);
  });

  it.each(["entries", "bytes"])(
    "checks current %s capacity transactionally and counts new parents",
    async (limit) => {
      const { backend, owner, userId, threadId } = await setup();
      const snapshot = await backend.mutation(internal.scout.workspaces.snapshot, {
        threadId,
        userId,
      });
      const file = {
        kind: "file",
        path: "/workspace/sources/example.com/source.md",
        key: "new",
        size: 1,
        sha256: "test",
        mode: 0o644,
        mtime: 0,
      } satisfies WorkspaceEntry;
      await backend.run(async (ctx) => {
        if (limit === "entries") {
          for (let i = 0; i < MAX_WORKSPACE_ENTRIES - 4; i++)
            await ctx.db.insert("scoutWorkspaceFiles", {
              workspaceId: snapshot.workspaceId,
              entry: { kind: "directory", path: `/workspace/dir-${i}`, mode: 0o755, mtime: 0 },
            });
        } else {
          for (let i = 0; i < MAX_WORKSPACE_BYTES / MAX_WORKSPACE_FILE_BYTES; i++)
            await ctx.db.insert("scoutWorkspaceFiles", {
              workspaceId: snapshot.workspaceId,
              entry: {
                ...file,
                path: `/workspace/file-${i}`,
                size: MAX_WORKSPACE_FILE_BYTES - (i === 0 ? 1 : 0),
                key: `old-${i}`,
              },
            });
        }
      });
      await backend.mutation(internal.scout.workspaces.addFile, {
        workspaceId: snapshot.workspaceId,
        userId,
        entry: file,
      });
      const before = await owner.query(api.scout.workspaces.list, { threadId });
      await expect(
        backend.mutation(internal.scout.workspaces.addFile, {
          workspaceId: snapshot.workspaceId,
          userId,
          entry: { ...file, path: "/workspace/sources/example.com/another.md", key: "another" },
        }),
      ).rejects.toThrow("limit exceeded");
      expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(before);
    },
  );
});

describe("Workspace tool results", () => {
  it.each([
    {
      toolName: "web_search",
      payload: { results: [] },
      text: JSON.stringify({ results: [] }, null, 2),
      extension: "json",
    },
    {
      toolName: "list_messages",
      payload: { content: [{ type: "text", text: '{"messages":[]}' }] },
      text: JSON.stringify({ messages: [] }, null, 2),
      extension: "json",
    },
    {
      toolName: "get_thread",
      payload: { content: [{ type: "text", text: "One message." }] },
      text: "One message.",
      extension: "txt",
    },
  ])(
    "saves small $toolName results and includes their full preview",
    async ({ toolName, payload, text, extension }) => {
      const { owner, threadId, userId, run } = await setup();
      const modelOutput = await owner.action(async (ctx) => {
        const selected = requireRuntimeTool(
          withWorkspaceResults(
            ctx,
            { threadId, userId },
            {
              [toolName]: tool({ inputSchema: z.object({}), execute: async () => payload }),
            },
          ),
          toolName,
        );
        const output = await selected.execute(
          {},
          { toolCallId: "small-read", messages: [], context: {} },
        );
        return selected.toModelOutput?.({ toolCallId: "small-read", input: {}, output });
      });
      if (modelOutput?.type !== "json") throw new Error("Expected file reference");
      const ref = z
        .object({
          path: z.string(),
          byteCount: z.number(),
          excerpt: z.string(),
          excerptTruncated: z.boolean(),
        })
        .parse(modelOutput.value);
      expect(ref.path).toMatch(
        new RegExp(`^/workspace/results/${toolName}-[a-f0-9]{8}\\.${extension}$`),
      );
      expect(ref).toMatchObject({
        excerpt: text,
        excerptTruncated: false,
        byteCount: new TextEncoder().encode(text).byteLength,
      });
      const inspected = await run(`cat ${ref.path}`);
      if (inspected.outcome.kind !== "success") throw new Error(inspected.outcome.error);
      expect(bashResultSchema.parse(JSON.parse(inspected.outcome.output))).toMatchObject({
        exitCode: 0,
        stdout: text,
      });
    },
  );

  it.each([
    { text: "邮".repeat(2666) + "ab", truncated: false },
    { text: "邮".repeat(2666) + "abc", truncated: true },
  ])(
    "uses UTF-8 size only to limit the preview (truncated: $truncated)",
    async ({ text, truncated }) => {
      const { owner, threadId, userId } = await setup();
      const result = await owner.action((ctx) =>
        saveToolResult(ctx, { threadId, userId }, "get_thread", {
          content: [{ type: "text", text }],
        }),
      );
      if (result.kind !== "file") throw new Error("Expected saved result");
      expect(result.value.byteCount).toBe(INLINE_TOOL_RESULT_BYTES + Number(truncated));
      expect(result.value.excerptTruncated).toBe(truncated);
      if (truncated) expect(result.value.excerpt.length).toBeLessThan(text.length);
      else expect(result.value.excerpt).toBe(text);
      const file = await owner.action(api.scout.workspaceTools.readFile, {
        threadId,
        path: result.value.path,
      });
      expect(file.text).toBe(text);
    },
  );

  it("lets the model inspect a complete large email result with bash across calls", async () => {
    const { owner, other, threadId, userId, run } = await setup();
    const payload = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            messages: [{ body: "邮件 🌍".repeat(16000) + "TAIL_EVIDENCE" }],
            nextPageToken: "next-page",
          }),
        },
      ],
      isError: false,
    };
    const messageData = JSON.parse(payload.content[0]?.text ?? "null");
    const providerResponse = { ...payload, structuredContent: messageData };
    expect(new TextEncoder().encode(JSON.stringify(providerResponse)).byteLength).toBeGreaterThan(
      MAX_WORKSPACE_FILE_BYTES,
    );
    const providerAdapter = vi.fn(() => ({
      type: "text" as const,
      value: "small provider result",
    }));
    const modelOutput = await owner.action(async (ctx) => {
      const tools = withWorkspaceResults(
        ctx,
        { threadId, userId },
        {
          get_thread: tool({
            inputSchema: z.object({ threadId: z.string() }),
            execute: async () => providerResponse,
            toModelOutput: providerAdapter,
          }),
        },
      );
      const selected = requireRuntimeTool(tools, "get_thread");
      const input = { threadId: "mail-thread" };
      const output = await selected.execute(input, {
        toolCallId: "mail-read",
        messages: [],
        context: {},
      });
      return selected.toModelOutput?.({ toolCallId: "mail-read", input, output });
    });
    expect(providerAdapter).not.toHaveBeenCalled();
    expect(modelOutput?.type).toBe("json");
    if (modelOutput?.type !== "json") throw new Error("Expected file reference");
    const ref = z
      .object({ path: z.string(), byteCount: z.number(), excerpt: z.string() })
      .parse(modelOutput.value);
    expect(ref.excerpt).not.toContain("TAIL_EVIDENCE");
    expect(ref.byteCount).toBeLessThan(MAX_WORKSPACE_FILE_BYTES);
    const file = await owner.action(api.scout.workspaceTools.readFile, {
      threadId,
      path: ref.path,
    });
    expect(JSON.parse(file.text ?? "null")).toEqual(JSON.parse(payload.content[0]?.text ?? "null"));
    expect(file.bytes.byteLength).toBe(ref.byteCount);
    const inspected = await run(
      `jq -r '.messages[0].body | endswith("TAIL_EVIDENCE")' ${ref.path}`,
    );
    if (inspected.outcome.kind !== "success") throw new Error(inspected.outcome.error);
    expect(bashResultSchema.parse(JSON.parse(inspected.outcome.output))).toMatchObject({
      exitCode: 0,
      stdout: "true\n",
    });
    await expect(
      other.action(api.scout.workspaceTools.readFile, { threadId, path: ref.path }),
    ).rejects.toThrow("Chat not found");
  });

  it("preserves provider errors without requiring storage", async () => {
    const { owner, threadId, userId } = await setup();
    vi.stubEnv("R2_BUCKET", "");
    const failure = {
      isError: true,
      content: [{ type: "text", text: "Provider failure ".repeat(1000) }],
    };
    for (const payload of [{ success: false, error: "Not available" }, failure]) {
      const adapter = vi.fn(({ output }: { output: unknown }) => ({
        type: "json" as const,
        value: z.json().parse(output),
      }));
      const result = await owner.action(async (ctx) => {
        const selected = requireRuntimeTool(
          withWorkspaceResults(
            ctx,
            { threadId, userId },
            {
              list_messages: tool({
                inputSchema: z.object({}),
                execute: async () => payload,
                toModelOutput: adapter,
              }),
            },
          ),
          "list_messages",
        );
        const output = await selected.execute(
          {},
          { toolCallId: "read", messages: [], context: {} },
        );
        return selected.toModelOutput?.({ toolCallId: "read", input: {}, output });
      });
      expect(result).toEqual({ type: "json", value: payload });
      expect(adapter).toHaveBeenCalledOnce();
    }
    expect(blobs.size).toBe(0);
  });

  it.each(["Short page.", "page content ".repeat(1000) + "END_OF_PAGE"])(
    "saves complete crawl results for manual calls and their persisted transcripts",
    async (text) => {
      const { owner, threadId } = await setup();
      vi.spyOn(Firecrawl.prototype, "crawl").mockResolvedValue({
        id: "crawl-id",
        status: "completed",
        total: 1,
        completed: 1,
        creditsUsed: 1,
        data: [{ markdown: text, metadata: { sourceURL: "https://example.com/deep" } }],
      });
      const result = await owner.action(api.scout.manual.executeTool, {
        threadId,
        toolName: "web_crawl",
        input: JSON.stringify({ url: "https://example.com", limit: 1 }),
        operationId: crypto.randomUUID(),
      });
      if (result.outcome.kind !== "success") throw new Error(result.outcome.error);
      const ref = z
        .object({ path: z.string(), excerpt: z.string() })
        .parse(JSON.parse(result.outcome.output));
      expect(ref.excerpt).not.toContain("END_OF_PAGE");
      const file = await owner.action(api.scout.workspaceTools.readFile, {
        threadId,
        path: ref.path,
      });
      expect(JSON.parse(file.text ?? "null")).toMatchObject({
        crawlId: "crawl-id",
        creditsUsed: 1,
        pages: [{ text, url: "https://example.com/deep" }],
      });
      const messages = await owner.query(api.scout.chats.listMessages, {
        threadId,
        paginationOpts: { numItems: 20, cursor: null },
      });
      expect(JSON.stringify(messages)).toContain(ref.path);
    },
  );

  it("reports storage and oversize failures without confirming or truncating a saved result", async () => {
    const { owner, threadId, userId } = await setup();
    const save = (output: unknown) =>
      owner.action((ctx) => saveToolResult(ctx, { threadId, userId }, "web_map", output));
    await expect(save({ text: "x".repeat(MAX_WORKSPACE_FILE_BYTES) })).rejects.toThrow(
      "No truncated copy",
    );
    expect(blobs.size).toBe(0);
    vi.spyOn(R2.prototype, "store").mockRejectedValueOnce(new Error("R2 unavailable"));
    await expect(save({ links: [] })).rejects.toThrow("R2 unavailable");
    expect((await owner.query(api.scout.workspaces.list, { threadId })).entries).toEqual([]);
  });

  it("does not revise an unchanged workspace when bash reads run in parallel", async () => {
    const { owner, threadId, userId, run } = await setup();
    await run("echo existing > saved.txt");
    const before = await owner.query(api.scout.workspaces.list, { threadId });
    const outputs = await Promise.all(
      ["cat saved.txt", "wc -l saved.txt"].map((command) =>
        owner.action(async (ctx) => {
          return createWorkspaceTools(ctx, { threadId, userId }, async () => {}).bash.execute(
            { command },
            { toolCallId: crypto.randomUUID(), messages: [], context: {} },
          );
        }),
      ),
    );
    expect(outputs.map((output) => bashResultSchema.parse(output).exitCode)).toEqual([0, 0]);
    expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(before);
  });
});
