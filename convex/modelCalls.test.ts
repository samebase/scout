import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import { EXPIRED_TURN_FAILURE } from "./scout/turns";

const modules = import.meta.glob("./**/*.ts");

async function setupExpiredAgentTurn(label: string) {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  const thread = await backend.mutation(components.agent.threads.createThread, {
    userId: `expired-${label}`,
  });
  const prompt = (
    await backend.mutation(components.agent.messages.addMessages, {
      threadId: thread._id,
      messages: [{ message: { role: "user", content: `Expire via ${label}` } }],
    })
  ).messages[0];
  if (!prompt) throw new Error("Prompt message was not created");
  const response = (
    await backend.mutation(components.agent.messages.addMessages, {
      threadId: thread._id,
      promptMessageId: prompt._id,
      messages: [{ message: { role: "assistant", content: [] }, status: "pending" }],
    })
  ).messages[0];
  if (!response) throw new Error("Pending response was not created");
  const { modelCallId, turnId } = await backend.run(async (ctx) => {
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Conrad Scout",
      websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
      slug: `conrad-expired-${label}`,
      status: "active",
      agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
      firecrawl: { profileName: "conrad-profile" },
    });
    const turnId = await ctx.db.insert("scoutTurns", {
      threadId: thread._id,
      order: prompt.order,
      promptMessageId: prompt._id,
      scoutId,
      model: "qwen/qwen3.7-flash",
      startedAt: Date.now() - 60_000,
      state: {
        kind: "pending",
        leaseExpiresAt: Date.now() - 1,
        completedSteps: 1,
        usage: { promptTokens: 10 },
      },
    });
    const snapshotStorageId = await ctx.storage.store(new Blob(["{}"]));
    const modelCallId = await ctx.db.insert("scoutModelCalls", {
      turnId,
      sequence: 1,
      provider: "gateway",
      modelId: "qwen/qwen3.7-flash",
      startedAt: Date.now() - 30_000,
      messageCount: 2,
      toolCount: 1,
      compactedBrowserSnapshotCount: 0,
      serializedBytes: 2,
      snapshotStorageId,
      state: { kind: "pending" },
    });
    return { modelCallId, turnId };
  });
  return { backend, modelCallId, promptMessageId: prompt._id, responseId: response._id, turnId };
}

describe("Scout model-call inputs", () => {
  test("terminalizes Agent responses and model calls whenever a turn expires", async () => {
    for (const entrypoint of ["scheduled expiry", "slice start"] as const) {
      const context = await setupExpiredAgentTurn(entrypoint.replace(" ", "-"));
      if (entrypoint === "scheduled expiry") {
        await context.backend.mutation(internal.scout.turns.expire, {
          turnId: context.turnId,
        });
      } else {
        await expect(
          context.backend.mutation(internal.scout.turns.start, {
            promptMessageId: context.promptMessageId,
          }),
        ).resolves.toBeNull();
      }

      await expect(
        context.backend.query(components.agent.messages.getMessagesByIds, {
          messageIds: [context.responseId],
        }),
      ).resolves.toEqual([
        expect.objectContaining({ status: "failed", error: EXPIRED_TURN_FAILURE }),
      ]);
      expect(
        await context.backend.run(async (ctx) => (await ctx.db.get(context.modelCallId))?.state),
      ).toMatchObject({ kind: "failed", failure: EXPIRED_TURN_FAILURE });
      expect(
        await context.backend.run(async (ctx) => (await ctx.db.get(context.turnId))?.state),
      ).toMatchObject({ kind: "failed", failure: EXPIRED_TURN_FAILURE });
    }
  });

  test("checkpoints call usage through expiry and closes an in-flight call on workflow failure", async () => {
    const backend = convexTest(schema, modules);
    agentTest.register(backend);
    const agentThread = await backend.mutation(components.agent.threads.createThread, {
      userId: "checkpoint-user",
    });
    const promptMessage = (
      await backend.mutation(components.agent.messages.addMessages, {
        threadId: agentThread._id,
        messages: [{ message: { role: "user", content: "Checkpoint usage" } }],
      })
    ).messages[0];
    if (!promptMessage) throw new Error("Prompt message was not created");
    const { firstCallId, pendingCallId, turnId } = await backend.run(async (ctx) => {
      const scoutId = await ctx.db.insert("scouts", {
        displayName: "Conrad Scout",
        websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
        slug: "conrad-checkpoint",
        status: "active",
        agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
        firecrawl: { profileName: "conrad-profile" },
      });
      const turnId = await ctx.db.insert("scoutTurns", {
        threadId: agentThread._id,
        order: promptMessage.order,
        promptMessageId: promptMessage._id,
        scoutId,
        model: "qwen/qwen3.7-flash",
        startedAt: 1,
        state: {
          kind: "pending",
          leaseExpiresAt: Date.now() + 60_000,
          completedSteps: 0,
          usage: { promptTokens: 10 },
        },
      });
      const snapshotStorageId = await ctx.storage.store(new Blob(["{}"]));
      const firstCallId = await ctx.db.insert("scoutModelCalls", {
        turnId,
        sequence: 1,
        provider: "gateway",
        modelId: "qwen/qwen3.7-flash",
        startedAt: 1,
        messageCount: 1,
        toolCount: 1,
        compactedBrowserSnapshotCount: 0,
        serializedBytes: 2,
        snapshotStorageId,
        state: { kind: "pending" },
      });
      const pendingCallId = await ctx.db.insert("scoutModelCalls", {
        turnId,
        sequence: 2,
        provider: "gateway",
        modelId: "qwen/qwen3.7-flash",
        startedAt: 2,
        messageCount: 3,
        toolCount: 1,
        compactedBrowserSnapshotCount: 0,
        serializedBytes: 2,
        snapshotStorageId,
        state: { kind: "pending" },
      });
      return { firstCallId, pendingCallId, turnId };
    });

    const usage = { promptTokens: 20, completionTokens: 3, totalTokens: 23, costUsd: 0.001 };
    await backend.mutation(internal.scout.modelCalls.recordEnd, {
      modelCallId: firstCallId,
      finishReason: "tool-calls",
      usage,
    });
    await backend.mutation(internal.scout.modelCalls.recordEnd, {
      modelCallId: firstCallId,
      finishReason: "tool-calls",
      usage,
    });

    expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state)).toMatchObject({
      kind: "pending",
      usage: { promptTokens: 30, completionTokens: 3, totalTokens: 23, costUsd: 0.001 },
    });

    await backend.run(async (ctx) => {
      const turn = await ctx.db.get(turnId);
      if (!turn || turn.state.kind !== "pending") throw new Error("Pending turn not found");
      await ctx.db.patch(turnId, {
        state: {
          kind: "failed",
          failedAt: Date.now(),
          failure: "Scout turn expired",
          usage: turn.state.usage,
        },
      });
    });
    await backend.mutation(internal.scout.modelCalls.recordEnd, {
      modelCallId: pendingCallId,
      finishReason: "tool-calls",
      usage: { promptTokens: 40, completionTokens: 4, totalTokens: 44, costUsd: 0.002 },
    });
    expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state)).toMatchObject({
      kind: "failed",
      usage: { promptTokens: 70, completionTokens: 7, totalTokens: 67, costUsd: 0.003 },
    });

    const lastCallId = await backend.run(async (ctx) => {
      const firstCall = await ctx.db.get(firstCallId);
      if (!firstCall) throw new Error("Model call not found");
      return await ctx.db.insert("scoutModelCalls", {
        turnId,
        sequence: 3,
        provider: "gateway",
        modelId: "qwen/qwen3.7-flash",
        startedAt: 3,
        messageCount: 5,
        toolCount: 1,
        compactedBrowserSnapshotCount: 0,
        serializedBytes: 2,
        snapshotStorageId: firstCall.snapshotStorageId,
        state: { kind: "pending" },
      });
    });

    await backend.mutation(internal.scout.turns.failWorkflow, {
      turnId,
      failure: "Scout workflow was canceled",
    });
    expect(await backend.run(async (ctx) => (await ctx.db.get(lastCallId))?.state)).toMatchObject({
      kind: "failed",
      failure: "Scout workflow was canceled",
    });
    expect(await backend.run(async (ctx) => (await ctx.db.get(turnId))?.state)).toMatchObject({
      kind: "failed",
      usage: { promptTokens: 70, completionTokens: 7, totalTokens: 67, costUsd: 0.003 },
    });
  });

  test("fails an orphaned Agent response without touching a newer turn", async () => {
    const backend = convexTest(schema, modules);
    agentTest.register(backend);
    const { ownerId, scoutId } = await backend.run(async (ctx) => ({
      ownerId: await insertTestAccount(ctx, { email: ADMIN_EMAIL, role: "role_admin" }),
      scoutId: await ctx.db.insert("scouts", {
        displayName: "Conrad Scout",
        websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
        slug: "conrad-orphaned-response",
        status: "active",
        agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
        firecrawl: { profileName: "conrad-profile" },
      }),
    }));
    const owner = backend.withIdentity({ subject: `${ownerId}|owner-session` });
    const { threadId } = await owner.mutation(api.scout.chats.createThread, { scoutId });
    const firstPrompt = (
      await backend.mutation(components.agent.messages.addMessages, {
        threadId,
        messages: [{ message: { role: "user", content: "First turn" } }],
      })
    ).messages[0];
    if (!firstPrompt) throw new Error("Prompt message was not created");
    const orphaned = (
      await backend.mutation(components.agent.messages.addMessages, {
        threadId,
        promptMessageId: firstPrompt._id,
        messages: [{ message: { role: "assistant", content: [] }, status: "pending" }],
      })
    ).messages[0];
    if (!orphaned) throw new Error("Pending response was not created");
    const firstTurnId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scoutTurns", {
          threadId,
          order: firstPrompt.order,
          promptMessageId: firstPrompt._id,
          scoutId,
          model: "qwen/qwen3.7-flash",
          startedAt: 1,
          state: {
            kind: "pending",
            leaseExpiresAt: Date.now() + 60_000,
            completedSteps: 0,
            usage: {},
          },
        }),
    );

    await backend.mutation(internal.scout.turns.failWorkflow, {
      turnId: firstTurnId,
      failure: "Scout slice exceeded its action limit",
    });
    await backend.mutation(internal.scout.turns.failWorkflow, {
      turnId: firstTurnId,
      failure: "Scout slice exceeded its action limit",
    });
    await expect(
      backend.query(components.agent.messages.getMessagesByIds, {
        messageIds: [orphaned._id],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        _id: orphaned._id,
        status: "failed",
        error: "Scout slice exceeded its action limit",
      }),
    ]);

    const nextPrompt = (
      await backend.mutation(components.agent.messages.addMessages, {
        threadId,
        messages: [{ message: { role: "user", content: "Second turn" } }],
      })
    ).messages[0];
    if (!nextPrompt) throw new Error("Second prompt message was not created");
    const nextPending = (
      await backend.mutation(components.agent.messages.addMessages, {
        threadId,
        promptMessageId: nextPrompt._id,
        messages: [{ message: { role: "assistant", content: [] }, status: "pending" }],
      })
    ).messages[0];
    if (!nextPending) throw new Error("Second pending response was not created");

    await backend.mutation(internal.scout.turns.failWorkflow, {
      turnId: firstTurnId,
      failure: "Delayed workflow cleanup",
    });
    await expect(
      backend.query(components.agent.messages.getMessagesByIds, {
        messageIds: [nextPending._id],
      }),
    ).resolves.toEqual([expect.objectContaining({ _id: nextPending._id, status: "pending" })]);
  });

  test("lists summaries and returns the stored SDK input only to the chat owner", async () => {
    const backend = convexTest(schema, modules);
    agentTest.register(backend);
    const { ownerId, outsiderId, scoutId } = await backend.run(async (ctx) => ({
      ownerId: await insertTestAccount(ctx, { email: ADMIN_EMAIL, role: "role_admin" }),
      outsiderId: await insertTestAccount(ctx, { email: ADMIN_EMAIL, role: "role_admin" }),
      scoutId: await ctx.db.insert("scouts", {
        displayName: "Conrad Scout",
        websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
        slug: "conrad-model-input",
        status: "active",
        agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
        firecrawl: { profileName: "conrad-profile" },
      }),
    }));
    const owner = backend.withIdentity({ subject: `${ownerId}|owner-session` });
    const outsider = backend.withIdentity({ subject: `${outsiderId}|outsider-session` });
    const { threadId } = await owner.mutation(api.scout.chats.createThread, { scoutId });
    const { threadId: otherThreadId } = await owner.mutation(api.scout.chats.createThread, {
      scoutId,
    });
    const snapshot = JSON.stringify({
      version: 1,
      instructions: "Use the browser.",
      messages: [{ role: "user", content: "Open Samebase" }],
      tools: [],
      settings: {},
    });
    const { modelCallId, turnId } = await backend.run(async (ctx) => {
      const turnId = await ctx.db.insert("scoutTurns", {
        threadId,
        order: 0,
        promptMessageId: "prompt-1",
        scoutId,
        model: "qwen/qwen3.7-flash",
        startedAt: 1,
        state: {
          kind: "completed",
          completedAt: 2,
          usage: { promptTokens: 12, completionTokens: 3 },
        },
      });
      const snapshotStorageId = await ctx.storage.store(
        new Blob([snapshot], { type: "application/json" }),
      );
      const modelCallId = await ctx.db.insert("scoutModelCalls", {
        turnId,
        sequence: 1,
        provider: "gateway",
        modelId: "qwen/qwen3.7-flash",
        startedAt: 1,
        messageCount: 1,
        toolCount: 0,
        compactedBrowserSnapshotCount: 0,
        serializedBytes: new TextEncoder().encode(snapshot).byteLength,
        snapshotStorageId,
        state: {
          kind: "completed",
          finishedAt: 2,
          finishReason: "stop",
          usage: { promptTokens: 12, completionTokens: 3 },
        },
      });
      return { modelCallId, turnId };
    });

    await expect(owner.query(api.scout.modelCalls.listForTurn, { turnId })).resolves.toEqual([
      expect.objectContaining({ modelCallId, sequence: 1, messageCount: 1, toolCount: 0 }),
    ]);
    await expect(
      owner.action(api.scout.modelCalls.getContext, { modelCallId, threadId }),
    ).resolves.toMatchObject({ snapshot, summary: { modelCallId, sequence: 1 } });
    await expect(
      owner.action(api.scout.modelCalls.getContext, { modelCallId, threadId: otherThreadId }),
    ).resolves.toBeNull();
    await expect(outsider.query(api.scout.modelCalls.listForTurn, { turnId })).rejects.toThrow(
      "Thread not found",
    );
    await expect(
      outsider.action(api.scout.modelCalls.getContext, { modelCallId, threadId }),
    ).rejects.toThrow("Thread not found");
  });
});
