/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { R2 } from "@convex-dev/r2";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
import schema from "./schema";
import { bashResultSchema } from "./workspaceModel";

const modules = import.meta.glob("./**/*.ts");
const blobs = new Map<string, Uint8Array>();
const deleted: string[] = [];

beforeEach(() => {
  blobs.clear();
  deleted.length = 0;
  vi.stubEnv("R2_BUCKET", "workspace-test");
  vi.stubEnv("R2_ENDPOINT", "https://storage.example.test");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://workspace-test.convex.cloud");
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
  return { backend, owner, other, userId, threadId, otherThreadId: otherThread.threadId, run };
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
    expect([...blobs.keys()][0]).toMatch(/\/reports\/hello\.txt$/);
    expect(
      await owner.action(api.scout.workspaceTools.readFile, {
        threadId,
        path: "/workspace/reports/hello.txt",
      }),
    ).toMatchObject({ text: "hello\n" });
    const second = await run("cat hello.txt");
    if (second.outcome.kind !== "success") throw new Error(second.outcome.error);
    expect(bashResultSchema.parse(JSON.parse(second.outcome.output))).toMatchObject({
      stdout: "hello\n",
      revision: 2,
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
          `^deployments/workspace-test\\.convex\\.cloud/users/${userId}/threads/${threadId}/files/[^/]+/report\\.json$`,
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
    await expect(
      backend.mutation(internal.scout.workspaces.commit, {
        workspaceId: stale.workspaceId,
        expectedRevision: stale.revision,
        entries: stale.entries,
        cwd: stale.cwd,
      }),
    ).rejects.toThrow("Another command");
    expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(current);
    expect(deleted).toHaveLength(1);
    await run("rm report.txt");
    expect(deleted).toHaveLength(2);
  });

  it("reports missing or corrupt stored files rather than silently substituting empty content", async () => {
    const { owner, threadId, run } = await setup();
    await run("printf original > report.txt");
    const before = await owner.query(api.scout.workspaces.list, { threadId });
    for (const key of blobs.keys()) blobs.set(key, new TextEncoder().encode("corrupt"));
    expect((await run("cat report.txt")).outcome).toMatchObject({
      kind: "error",
      error: expect.stringContaining("integrity"),
    });
    blobs.clear();
    expect((await run("cat report.txt")).outcome).toMatchObject({
      kind: "error",
      error: expect.stringContaining("404"),
    });
    expect(await owner.query(api.scout.workspaces.list, { threadId })).toEqual(before);
  });
});
