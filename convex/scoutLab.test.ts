/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const labManualApi = anyApi["scout"]["labManual"];

function testBackend() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  return backend;
}

describe("Scout Lab", () => {
  it("creates a developer experiment and stores messages as shared Scout turns", async () => {
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
    const { experimentId } = await admin.mutation(api.scout.lab.createExperiment, {
      name: "Explore Tally",
      scoutId,
      targetProduct: "Tally",
      targetDomain: "tally.so",
      objective: "Explore the current onboarding.",
    });
    const { threadId } = await admin.mutation(api.scout.lab.createThread, { experimentId });
    await admin.mutation(api.scout.lab.sendMessage, {
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
    const { experimentId } = await admin.mutation(api.scout.lab.createExperiment, {
      name: "Manual tools",
      scoutId,
      targetProduct: "Samebase",
      targetDomain: "samebase.com",
      objective: "Exercise the Lab tools directly.",
    });
    const { threadId } = await admin.mutation(api.scout.lab.createThread, { experimentId });

    const result = await admin.action(labManualApi["executeTool"], {
      threadId,
      toolName: "inspect_tool_arguments",
      input: {
        stringValue: "plain text",
        numberValue: 42,
        booleanValue: true,
        objectValue: { label: "nested", count: 2 },
        arrayValue: ["alpha", "beta"],
        nullValue: null,
      },
    });

    expect(result).toMatchObject({
      toolCallId: expect.any(String),
      outcome: {
        kind: "success",
        output: {
          received: {
            numberValue: { type: "number", value: 42 },
            nullValue: { type: "null", value: null },
          },
        },
      },
    });
    const invalid = await admin.action(labManualApi["executeTool"], {
      threadId,
      toolName: "inspect_tool_arguments",
      input: {},
    });
    expect(invalid).toMatchObject({
      toolCallId: expect.any(String),
      outcome: { kind: "error", error: expect.any(String) },
    });
    const messages = await admin.query(api.scout.lab.listMessages, {
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
    const { experimentId } = await admin.mutation(api.scout.lab.createExperiment, {
      name: "Session ownership",
      scoutId,
      targetProduct: "Samebase",
      targetDomain: "samebase.com",
      objective: "Keep one browser attached to this thread.",
    });
    const { threadId } = await admin.mutation(api.scout.lab.createThread, { experimentId });
    const recorded = await admin.mutation(anyApi["scout"]["labBrowserSessions"]["open"], {
      threadId,
      scoutId,
      providerSessionId: "provider-session-secret",
      profileName: "session-profile",
    });

    await expect(
      admin.query(anyApi["scout"]["labManualState"]["runtimeContext"], { threadId }),
    ).resolves.toMatchObject({ providerSessionId: "provider-session-secret", scoutId });
    await expect(admin.query(api.scout.labBrowserSessions.list, { threadId })).resolves.toEqual([
      expect.objectContaining({
        sessionId: recorded.sessionId,
        sequence: 1,
        lifecycle: expect.objectContaining({ kind: "active" }),
      }),
    ]);
    const other = backend.withIdentity({ subject: `${otherUserId}|test-session` });
    await expect(
      other.query(anyApi["scout"]["labManualState"]["runtimeContext"], { threadId }),
    ).rejects.toThrow();
    await expect(other.query(api.scout.labBrowserSessions.list, { threadId })).resolves.toEqual([]);
    await admin.mutation(anyApi["scout"]["labBrowserSessions"]["close"], {
      sessionId: recorded.sessionId,
      providerDurationMs: 1_000,
      creditsBilled: 2,
    });
    await expect(
      admin.query(anyApi["scout"]["labManualState"]["runtimeContext"], { threadId }),
    ).resolves.toMatchObject({ providerSessionId: null });
  });
});
