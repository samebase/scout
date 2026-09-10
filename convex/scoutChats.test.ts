import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import { finishStoppingTurn } from "./scout/turns";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function testBackend() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  return backend;
}

describe("Scout chats", () => {
  it.each(["openai/gpt-5.6-luna", "deepseek/deepseek-v4-flash-0731"] as const)(
    "creates a Scout chat and records a follow-up using %s",
    async (model) => {
      const backend = testBackend();
      const userId = await backend.run(
        async (ctx) => await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
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
        selection: model === "openai/gpt-5.6-luna" ? { model, reasoningEffort: "max" } : { model },
      });
      const followups = await backend.run(async (ctx) =>
        ctx.db
          .query("scoutTurns")
          .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", threadId))
          .take(10),
      );
      expect(followups.map((entry) => entry.model)).toEqual(["qwen/qwen3.7-flash", model]);
      expect(followups.every((entry) => entry.scoutId === scoutId)).toBe(true);
      if (model === "openai/gpt-5.6-luna") {
        expect(followups[1]).toMatchObject({ reasoningEffort: "max" });
        expect(
          await admin.query(internal.scout.chats.runtimeContext, {
            promptMessageId: followups[1].promptMessageId,
          }),
        ).toMatchObject({ reasoningEffort: "max" });
      }
    },
  );

  it("redacts another owner's Scout activity while preserving owned active chat activity", async () => {
    const backend = testBackend();
    const ownerId = await backend.run(
      async (ctx) => await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
    );
    const observerId = await backend.run(
      async (ctx) => await insertTestAccount(ctx, { email: "nicu@samebase.com" }),
    );
    const scoutId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scouts", {
          displayName: "Private Scout",
          websiteIdentity: { firstName: "Private", lastName: "Scout" },
          slug: "private-scout",
          status: "active",
          agentMail: { inboxId: "private-inbox", address: "private@example.test" },
          firecrawl: { profileName: "private-profile" },
        }),
    );
    const owner = backend.withIdentity({ subject: `${ownerId}|test-session` });
    const observer = backend.withIdentity({ subject: `${observerId}|test-session` });
    const ownerIdleThread = await owner.mutation(api.scout.chats.createThread, { scoutId });
    const ownerActiveThread = await owner.mutation(api.scout.chats.createThread, { scoutId });
    const observerThread = await observer.mutation(api.scout.chats.createThread, { scoutId });
    const prompt = (
      await backend.mutation(components.agent.messages.addMessages, {
        threadId: ownerActiveThread.threadId,
        messages: [{ message: { role: "user", content: "Run private work." } }],
      })
    ).messages[0];
    if (!prompt) throw new Error("Prompt message was not created");
    const cleanupFailure = "Firecrawl did not stop the private browser session";
    const turnId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scoutTurns", {
          threadId: ownerActiveThread.threadId,
          order: prompt.order,
          promptMessageId: prompt._id,
          scoutId,
          model: "qwen/qwen3.7-flash",
          startedAt: Date.now(),
          state: {
            kind: "stopping",
            stopRequestedAt: Date.now(),
            generationFinished: true,
            cleanupFailure,
            usage: {},
          },
        }),
    );

    await expect(
      owner.query(api.scout.chats.getScoutActivity, { threadId: ownerIdleThread.threadId }),
    ).resolves.toEqual({
      kind: "stopping",
      threadId: ownerActiveThread.threadId,
      turnId,
      retryable: true,
      failure: cleanupFailure,
    });
    const redacted = await observer.query(api.scout.chats.getScoutActivity, {
      threadId: observerThread.threadId,
    });
    expect(redacted).toEqual({ kind: "busy" });
    const serializedRedacted = JSON.stringify(redacted);
    expect(serializedRedacted).not.toContain(ownerActiveThread.threadId);
    expect(serializedRedacted).not.toContain(turnId);
    expect(serializedRedacted).not.toContain(cleanupFailure);
  });

  it.each([
    "follow-up",
    "stop",
    "closing",
    "handoff",
    "prepared",
    "indeterminate",
    "older-indeterminate",
    "execution-finished",
  ])(
    "preserves the browser for a follow-up and respects cleanup already in progress: %s",
    async (scenario) => {
      const preserve = scenario === "follow-up" || scenario === "execution-finished";
      const backend = testBackend();
      const userId = await backend.run(
        async (ctx) => await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
      );
      const scoutId = await backend.run(
        async (ctx) =>
          await ctx.db.insert("scouts", {
            displayName: "Stop Scout",
            websiteIdentity: { firstName: "Stop", lastName: "Scout" },
            slug: "stop-scout",
            status: "active",
            agentMail: { inboxId: "stop-inbox", address: "stop@example.test" },
            firecrawl: { profileName: "stop-profile" },
          }),
      );
      const admin = backend.withIdentity({ subject: `${userId}|test-session` });
      const { threadId } = await admin.mutation(api.scout.chats.createThread, { scoutId });
      const prompt = (
        await backend.mutation(components.agent.messages.addMessages, {
          threadId,
          messages: [{ message: { role: "user", content: "Inspect Samebase." } }],
        })
      ).messages[0];
      if (!prompt) throw new Error("Prompt message was not created");
      const turnId = await backend.run(
        async (ctx) =>
          await ctx.db.insert("scoutTurns", {
            threadId,
            order: prompt.order,
            promptMessageId: prompt._id,
            scoutId,
            model: "qwen/qwen3.7-flash",
            startedAt: Date.now(),
            state: {
              kind: "pending",
              leaseExpiresAt: Date.now() + 5 * 60 * 1_000,
              completedSteps: 0,
              usage: {},
            },
          }),
      );
      const { sessionId } = await backend.mutation(internal.scout.browserSessions.open, {
        threadId,
        scoutId,
        source: { kind: "turn", turnId },
        providerSessionId: "existing-browser",
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=existing",
        interactiveLiveViewUrl: "https://liveview.firecrawl.dev/existing",
        providerExpiresAtMs: Date.now() + 60 * 60 * 1_000,
        profileName: "stop-profile",
      });
      if (
        scenario === "prepared" ||
        scenario === "indeterminate" ||
        scenario === "older-indeterminate" ||
        scenario === "execution-finished"
      ) {
        await backend.mutation(internal.scout.browserSessions.prepareOperation, {
          sessionId,
          toolCallId: "in-flight-operation",
          action: { kind: "execute", code: "await page.locator('button').click()" },
        });
        if (scenario !== "prepared") {
          await backend.mutation(internal.scout.browserSessions.settleOperation, {
            sessionId,
            toolCallId: "in-flight-operation",
            outcome:
              scenario === "execution-finished"
                ? {
                    kind: "indeterminate_after_dispatch",
                    failure: "Locator was not found",
                    executionFinished: true,
                  }
                : {
                    kind: "indeterminate_after_dispatch",
                    failure: "Provider response was lost",
                  },
            clickCapture: { kind: "unavailable" },
          });
        }
        if (scenario === "older-indeterminate" || scenario === "execution-finished") {
          await backend.mutation(internal.scout.browserSessions.prepareOperation, {
            sessionId,
            toolCallId: "later-operation",
            action: { kind: "execute", code: "await page.title()" },
          });
          await backend.mutation(internal.scout.browserSessions.settleOperation, {
            sessionId,
            toolCallId: "later-operation",
            outcome: { kind: "failed_before_dispatch", failure: "Interrupted before dispatch" },
            clickCapture: { kind: "unavailable" },
          });
        }
      }
      if (scenario === "closing") {
        await backend.mutation(internal.scout.turns.beginBrowserCleanup, { turnId, sessionId });
      } else if (scenario === "handoff") {
        await backend.mutation(internal.humanHandoffs.request, {
          promptMessageId: prompt._id,
          reason: "The user requested browser control.",
          accessTokenHash: "a".repeat(64),
        });
      }
      const replacement = {
        prompt: "Hand it over to me.",
        model: "openai/gpt-5.6-luna" as const,
        reasoningEffort: "max" as const,
      };
      await admin.mutation(
        api.scout.chats.stop,
        scenario === "stop" ? { threadId } : { threadId, replacement },
      );
      await expect(backend.query(internal.scout.turns.assertPending, { turnId })).rejects.toThrow(
        "Scout turn is no longer running",
      );
      await expect(
        backend.run(async (ctx) => (await ctx.db.get(sessionId))?.lifecycle.kind),
      ).resolves.toBe(scenario === "closing" ? "closing" : "active");
      await expect(
        backend.mutation(internal.scout.turns.beginBrowserCleanup, { turnId, sessionId }),
      ).resolves.toBe(preserve ? "preserve" : "close");
      // The old generation must finish before any replacement can use its browser.
      await backend.mutation(internal.scout.turns.finalizeStopping, { turnId });
      expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state.kind)).toBe(
        "stopping",
      );
      await backend.run(async (ctx) => await finishStoppingTurn(ctx, turnId));
      if (!preserve) {
        expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state.kind)).toBe(
          "stopping",
        );
        await backend.mutation(internal.scout.browserSessions.close, {
          sessionId,
          providerDurationMs: 1_000,
          creditsBilled: 2,
          usageTurnId: turnId,
        });
        await backend.mutation(internal.scout.turns.finalizeStopping, { turnId });
      }
      if (scenario === "stop") {
        expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state.kind)).toBe(
          "stopped",
        );
        return;
      }
      expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state)).toMatchObject({
        kind: "replacing",
        replacement,
      });
      await expect(
        admin.mutation(internal.scout.browserSessions.open, {
          threadId,
          scoutId,
          source: { kind: "turn", turnId },
          providerSessionId: "late-provider-session",
          cdpUrl: "wss://browser.firecrawl.dev/cdp?token=late",
          interactiveLiveViewUrl: null,
          providerExpiresAtMs: Date.now() + 60 * 60 * 1_000,
          profileName: "stop-profile",
        }),
      ).rejects.toThrow("Active Scout turn not found");
      await backend.mutation(internal.scout.turns.dispatchReplacement, { turnId });
      await backend.mutation(internal.scout.turns.dispatchReplacement, { turnId });
      const turns = await backend.run(async (ctx) =>
        ctx.db
          .query("scoutTurns")
          .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", threadId))
          .take(10),
      );
      expect(turns).toHaveLength(2);
      expect(turns[1]).toMatchObject({ model: replacement.model, reasoningEffort: "max" });
      const next = turns[1];
      if (!next) throw new Error("Replacement turn was not created");
      expect(next.state.kind).toBe("pending");
      const context = await backend.query(internal.scout.chats.runtimeContext, {
        promptMessageId: next.promptMessageId,
      });
      if (!preserve) {
        expect(context.browserSession).toBeNull();
        return;
      }
      expect(context.browserSession?._id).toBe(sessionId);
      const handoff = await backend.mutation(internal.humanHandoffs.request, {
        promptMessageId: next.promptMessageId,
        reason: "The user requested browser control.",
        accessTokenHash: "b".repeat(64),
      });
      expect(handoff.recipientEmail).toBe(ADMIN_EMAIL);
      expect(
        await backend.run(async (ctx) =>
          ctx.db
            .query("scoutHumanHandoffDeliveries")
            .withIndex("by_handoff_id", (q) => q.eq("handoffId", handoff.handoffId))
            .unique(),
        ),
      ).toMatchObject({ recipientEmail: ADMIN_EMAIL, inboxId: "stop-inbox" });
      expect(await backend.run(async (ctx) => (await ctx.db.get(sessionId))?.lifecycle.kind)).toBe(
        "active",
      );
    },
  );

  it("runs a manual tool without a model and stores its call and result in the agent thread", async () => {
    const backend = testBackend();
    const userId = await backend.run(
      async (ctx) => await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
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
      async (ctx) => await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
    );
    const otherUserId = await backend.run(
      async (ctx) => await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
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
      source: { kind: "manual" },
      providerSessionId: "provider-session-secret",
      cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
      interactiveLiveViewUrl: null,
      providerExpiresAtMs: Date.now() + 60 * 60 * 1_000,
      profileName: "session-profile",
    });

    await expect(
      admin.query(internal.scout.manualState.runtimeContext, {
        threadId,
        requireBrowserAccess: true,
      }),
    ).resolves.toMatchObject({
      browserSession: {
        providerSessionId: "provider-session-secret",
        lifecycle: {
          kind: "active",
          cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
        },
      },
      scoutId,
    });
    const publicSessions = await admin.query(api.scout.browserSessions.list, { threadId });
    expect(publicSessions).toEqual([
      expect.objectContaining({
        sessionId: recorded.sessionId,
        sequence: 1,
        lifecycle: expect.objectContaining({ kind: "active" }),
      }),
    ]);
    const publicSession = await admin.query(api.scout.browserSessions.get, {
      sessionId: recorded.sessionId,
    });
    expect(JSON.stringify([publicSessions, publicSession])).not.toContain("token=secret");
    const other = backend.withIdentity({ subject: `${otherUserId}|test-session` });
    await expect(
      other.query(internal.scout.manualState.runtimeContext, {
        threadId,
        requireBrowserAccess: true,
      }),
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
        requireBrowserAccess: true,
      }),
    ).rejects.toThrow("open browser in another chat");
    await expect(
      admin.query(internal.scout.manualState.runtimeContext, {
        threadId: anotherChat.threadId,
        requireBrowserAccess: false,
      }),
    ).resolves.toMatchObject({ browserSession: null });
    await admin.mutation(internal.scout.browserSessions.close, {
      sessionId: recorded.sessionId,
      providerDurationMs: 1_000,
      creditsBilled: 2,
    });
    await expect(
      admin.query(internal.scout.manualState.runtimeContext, {
        threadId,
        requireBrowserAccess: true,
      }),
    ).resolves.toMatchObject({ browserSession: null });
    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutBrowserSessions", recorded.sessionId)),
    ).resolves.toMatchObject({ lifecycle: { kind: "closed" } });
  });
});
