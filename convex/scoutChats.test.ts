/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function testBackend() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  return backend;
}

describe("Scout chats", () => {
  it("creates a Scout chat without a product or experiment and records its generation", async () => {
    const backend = testBackend();
    const userId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const scoutId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scouts", {
          displayName: "Conrad Scout",
          websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
          slug: "conrad",
          status: "active",
          agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
          firecrawl: { profileName: "conrad-profile" },
        }),
    );
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const { threadId } = await admin.mutation(api.scout.chats.createThread, { scoutId });
    await admin.mutation(api.scout.chats.sendMessage, {
      threadId,
      prompt: "Open the product and report what you see.",
    });
    const turn = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutTurns")
          .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", threadId))
          .unique(),
    );
    expect(turn).toEqual(
      expect.objectContaining({
        scoutId,
        model: "qwen/qwen3.7-flash",
        state: expect.objectContaining({ kind: "pending" }),
      }),
    );
    if (!turn) throw new Error("Scout turn was not recorded");
    await admin.mutation(internal.scout.turns.complete, {
      promptMessageId: turn.promptMessageId,
      usage: { promptTokens: 100, completionTokens: 5 },
    });
    await admin.mutation(api.scout.chats.sendMessage, {
      threadId,
      prompt: "Continue in Cloudflare using the same Scout.",
      model: "openai/gpt-5.6-luna",
    });
    const followups = await backend.run(async (ctx) =>
      ctx.db
        .query("scoutTurns")
        .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", threadId))
        .take(10),
    );
    expect(followups.map((entry) => entry.model)).toEqual([
      "qwen/qwen3.7-flash",
      "openai/gpt-5.6-luna",
    ]);
    expect(followups.every((entry) => entry.scoutId === scoutId)).toBe(true);
  });

  it("runs a manual tool without a model and stores its call and result in the agent thread", async () => {
    const backend = testBackend();
    const userId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const scoutId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scouts", {
          displayName: "Conrad Scout",
          websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
          slug: "conrad-manual",
          status: "active",
          agentMail: { inboxId: "conrad-manual-inbox", address: "manual@example.test" },
          firecrawl: { profileName: "conrad-manual-profile" },
        }),
    );
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const { threadId } = await admin.mutation(api.scout.chats.createThread, { scoutId });

    const result = await admin.action(api.scout.manual.executeTool, {
      threadId,
      toolName: "inspect_tool_arguments",
      input: JSON.stringify({
        stringValue: "plain text",
        numberValue: 42,
        booleanValue: true,
        objectValue: { label: "nested", count: 2 },
        arrayValue: ["alpha", "beta"],
        nullValue: null,
      }),
      operationId: "manual-tool-valid",
    });

    expect(result.toolCallId).toEqual(expect.any(String));
    expect(result.outcome.kind).toBe("success");
    if (result.outcome.kind !== "success") throw new Error("Manual tool did not succeed");
    expect(JSON.parse(result.outcome.output)).toMatchObject({
      received: {
        numberValue: { type: "number", value: 42 },
        nullValue: { type: "null", value: null },
      },
    });
    const invalid = await admin.action(api.scout.manual.executeTool, {
      threadId,
      toolName: "inspect_tool_arguments",
      input: "{}",
      operationId: "manual-tool-invalid",
    });
    expect(invalid).toMatchObject({
      toolCallId: expect.any(String),
      outcome: { kind: "error", error: expect.any(String) },
    });
    const messages = await admin.query(api.scout.chats.listMessages, {
      threadId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(messages.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "tool-inspect_tool_arguments",
              state: "output-available",
              toolCallId: result.toolCallId,
            }),
          ]),
        }),
        expect.objectContaining({
          role: "assistant",
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "tool-inspect_tool_arguments",
              state: "output-error",
              toolCallId: invalid.toolCallId,
            }),
          ]),
        }),
      ]),
    );
    const turns = await backend.run(async (ctx) =>
      ctx.db
        .query("scoutTurns")
        .withIndex("by_thread_id_and_order", (query) => query.eq("threadId", threadId))
        .take(1),
    );
    expect(turns).toEqual([]);
  });

  it("keeps manual browser provider handles server-side and bound to the owned thread", async () => {
    const backend = testBackend();
    const userId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const otherUserId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const scoutId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scouts", {
          displayName: "Session Scout",
          websiteIdentity: { firstName: "Session", lastName: "Scout" },
          slug: "session-scout",
          status: "active",
          agentMail: { inboxId: "session-inbox", address: "session@example.test" },
          firecrawl: { profileName: "session-profile" },
        }),
    );
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const { threadId } = await admin.mutation(api.scout.chats.createThread, { scoutId });
    const recorded = await admin.mutation(internal.scout.browserSessions.open, {
      threadId,
      scoutId,
      providerSessionId: "provider-session-secret",
      profileName: "session-profile",
    });

    await expect(
      admin.query(internal.scout.manualState.runtimeContext, { threadId }),
    ).resolves.toMatchObject({ providerSessionId: "provider-session-secret", scoutId });
    await expect(admin.query(api.scout.browserSessions.list, { threadId })).resolves.toEqual([
      expect.objectContaining({
        sessionId: recorded.sessionId,
        sequence: 1,
        lifecycle: expect.objectContaining({ kind: "active" }),
      }),
    ]);
    const other = backend.withIdentity({ subject: `${otherUserId}|test-session` });
    await expect(
      other.query(internal.scout.manualState.runtimeContext, { threadId }),
    ).rejects.toThrow();
    await expect(other.query(api.scout.browserSessions.list, { threadId })).resolves.toEqual([]);
    const anotherChat = await admin.mutation(api.scout.chats.createThread, { scoutId });
    await expect(
      admin.mutation(api.scout.chats.sendMessage, {
        threadId: anotherChat.threadId,
        prompt: "Open GitHub.",
      }),
    ).rejects.toThrow("open browser in another chat");
    await expect(
      admin.query(internal.scout.manualState.runtimeContext, {
        threadId: anotherChat.threadId,
      }),
    ).rejects.toThrow("open browser in another chat");
    await admin.mutation(internal.scout.browserSessions.close, {
      sessionId: recorded.sessionId,
      providerDurationMs: 1_000,
      creditsBilled: 2,
    });
    await expect(
      admin.query(internal.scout.manualState.runtimeContext, { threadId }),
    ).resolves.toMatchObject({ providerSessionId: null });
  });
});
