/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { docsToModelMessages } from "@convex-dev/agent";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";
import { loadUncompactedMessages, prepareConversationContext } from "./scout/compactionContext";
import { preserveTurnObjective } from "./scout/generation";

async function setup() {
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  agentTest.register(backend);
  const { ownerId, outsiderId, scoutId } = await backend.run(async (ctx) => ({
    ownerId: await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    outsiderId: await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    scoutId: await ctx.db.insert("scouts", {
      displayName: "Compaction Scout",
      slug: "compaction",
      websiteIdentity: { firstName: "Compaction", lastName: "Scout" },
      status: "active",
      agentMail: { inboxId: "test", address: "test@example.test" },
      firecrawl: { profileName: "test" },
    }),
  }));
  const owner = backend.withIdentity({ subject: `${ownerId}|session` });
  const outsider = backend.withIdentity({ subject: `${outsiderId}|session` });
  const { threadId } = await owner.mutation(api.scout.chats.createThread, { scoutId });
  const objective = "Research these services and draft an email. Do not send it.";
  const [prompt] = (
    await backend.mutation(components.agent.messages.addMessages, {
      threadId,
      messages: [{ message: { role: "user", content: objective } }],
    })
  ).messages;
  const turnId = await backend.run(
    async (ctx) =>
      await ctx.db.insert("scoutTurns", {
        threadId,
        promptMessageId: prompt._id,
        order: prompt.order,
        scoutId,
        model: "qwen/qwen3.7-flash",
        startedAt: Date.now(),
        state: {
          kind: "pending",
          leaseExpiresAt: Date.now() + 60_000,
          completedSteps: 1,
          usage: {},
        },
      }),
  );
  const writeHistory = async (label: string, count: number, size: number) =>
    await backend.mutation(components.agent.messages.addMessages, {
      threadId,
      promptMessageId: prompt._id,
      messages: Array.from({ length: count }, (_, index) => ({
        message: {
          role: "assistant" as const,
          content: `${label} ${index}: ${"Useful source content. ".repeat(size)}`,
        },
      })),
    });
  const summarize = vi.fn(
    async (input: Parameters<Parameters<typeof prepareConversationContext>[1]["summarize"]>[0]) => {
      const snapshot = JSON.stringify({
        version: 1,
        instructions: "Summarize",
        messages: [{ role: "user", content: JSON.stringify(input) }],
        tools: [],
        settings: {},
      });
      const snapshotStorageId = await backend.run(
        async (ctx) => await ctx.storage.store(new Blob([snapshot])),
      );
      const modelCallId = await backend.mutation(internal.scout.modelCalls.recordStart, {
        turnId,
        purpose: { kind: "compaction" },
        provider: "test",
        modelId: "qwen/qwen3.7-flash",
        messageCount: 1,
        toolCount: 0,
        compactedBrowserSnapshotCount: 0,
        serializedBytes: snapshot.length,
        snapshotStorageId,
      });
      await backend.mutation(internal.scout.modelCalls.recordEnd, {
        modelCallId,
        finishReason: "stop",
        usage: { promptTokens: 3_000, completionTokens: 100, costUsd: 0.004 },
      });
      return {
        summary: `Research is underway. Keep exact source https://example.test/source. Do not send the email. Revision ${summarize.mock.calls.length}.`,
        modelCallId,
      };
    },
  );
  const options = {
    threadId,
    promptMessageId: prompt._id,
    threshold: 8_000,
    fixedTokens: 1_000,
    preserveObjective: (messages: Parameters<typeof preserveTurnObjective>[0]) =>
      preserveTurnObjective(messages, objective),
    summarize,
  };
  const prepare = () => backend.action(async (ctx) => prepareConversationContext(ctx, options));
  const readOriginal = () =>
    backend.action(async (ctx) => loadUncompactedMessages(ctx, { ...options, compaction: null }));
  return {
    backend,
    owner,
    outsider,
    threadId,
    turnId,
    prompt,
    objective,
    writeHistory,
    summarize,
    options,
    prepare,
    readOriginal,
  };
}

test("pages beyond the old 500-message window without losing unsummarized history", async () => {
  const t = await setup();
  await t.writeHistory("History", 520, 1);
  const original = await t.readOriginal();
  expect(original).toHaveLength(521);
  expect(original[0]._id).toBe(t.prompt._id);
  const prepared = await t.backend.action(async (ctx) =>
    prepareConversationContext(ctx, {
      ...t.options,
      threshold: 1_000_000,
    }),
  );
  expect(prepared.messages).toEqual(docsToModelMessages(original));
  expect(t.summarize).not.toHaveBeenCalled();
});

test("persists, reloads and advances summaries while preserving the transcript, objective and usage", async () => {
  const t = await setup();
  await t.writeHistory("First", 20, 100);
  const original = await t.readOriginal();
  const first = await t.prepare();
  expect(first.compactionId).not.toBeNull();
  expect(t.summarize).toHaveBeenCalledTimes(1);
  expect(first.messages).toContainEqual({ role: "user", content: t.objective });
  expect(first.messages.slice(-8)).toEqual(docsToModelMessages(original.slice(-8)));
  expect(await t.readOriginal()).toEqual(original);
  expect(await t.prepare()).toEqual(first);
  expect(t.summarize).toHaveBeenCalledTimes(1);
  const checkpoint = await t.backend.query(internal.scout.compactions.latest, {
    threadId: t.threadId,
  });
  if (!checkpoint) throw new Error("Summary missing");
  expect(checkpoint.afterTokens).toBeLessThan(checkpoint.beforeTokens);
  expect(checkpoint.coveredMessageCount).toBe(original.length - 8);
  expect(checkpoint.coveredThrough.messageId).toBe(original.at(-9)?._id);
  const { _id, _creationTime, ...saved } = checkpoint;
  expect(await t.backend.mutation(internal.scout.compactions.save, saved)).toBe(_id);
  expect(_creationTime).toBeGreaterThan(0);
  const detail = await t.owner.action(api.scout.modelCalls.getContext, {
    threadId: t.threadId,
    modelCallId: checkpoint.modelCallId,
  });
  expect(detail?.compaction).toMatchObject({
    checkpoint,
    call: { state: { usage: { costUsd: 0.004 } } },
  });
  await expect(
    t.outsider.action(api.scout.modelCalls.getContext, {
      threadId: t.threadId,
      modelCallId: checkpoint.modelCallId,
    }),
  ).rejects.toThrow("Thread not found");
  await expect(
    t.backend.action(api.scout.modelCalls.getContext, {
      threadId: t.threadId,
      modelCallId: checkpoint.modelCallId,
    }),
  ).rejects.toThrow();
  await t.writeHistory("Second", 16, 100);
  const second = await t.prepare();
  expect(second.compactionId).not.toBe(first.compactionId);
  expect(t.summarize.mock.calls[1][0].previousSummary).toBe(checkpoint.summary);
  const next = await t.backend.query(internal.scout.compactions.latest, { threadId: t.threadId });
  expect(next?.previousCompactionId).toBe(checkpoint._id);
  expect(next?.coveredMessageCount).toBeGreaterThan(checkpoint.coveredMessageCount);
  expect(
    (await t.backend.run(async (ctx) => await ctx.db.get(t.turnId)))?.state.usage?.costUsd,
  ).toBe(0.008);
  expect((await t.readOriginal()).slice(0, original.length)).toEqual(original);
});

test("failed and non-shrinking summaries do not consume history or replace the checkpoint", async () => {
  const t = await setup();
  await t.writeHistory("First", 20, 100);
  await t.prepare();
  const previous = await t.backend.query(internal.scout.compactions.latest, {
    threadId: t.threadId,
  });
  await t.writeHistory("More", 20, 100);
  const original = await t.readOriginal();
  await expect(
    t.backend.action(async (ctx) =>
      prepareConversationContext(ctx, {
        ...t.options,
        summarize: async () => {
          throw new Error("Provider unavailable");
        },
      }),
    ),
  ).rejects.toThrow("Provider unavailable");
  if (!previous) throw new Error("Summary missing");
  for (const summary of ["", "x".repeat(200_000)]) {
    await expect(
      t.backend.action(async (ctx) =>
        prepareConversationContext(ctx, {
          ...t.options,
          summarize: async () => ({ summary, modelCallId: previous.modelCallId }),
        }),
      ),
    ).rejects.toThrow("smaller nonempty summary");
  }
  expect(
    await t.backend.query(internal.scout.compactions.latest, { threadId: t.threadId }),
  ).toEqual(previous);
  expect(await t.readOriginal()).toEqual(original);
});

test("a later user turn reuses the summary with its new request and all unsummarized messages", async () => {
  const t = await setup();
  await t.writeHistory("Research", 20, 100);
  const first = await t.prepare();
  const [followup] = (
    await t.backend.mutation(components.agent.messages.addMessages, {
      threadId: t.threadId,
      messages: [
        {
          message: { role: "user", content: "Now compare the two sources, but still do not send." },
        },
      ],
    })
  ).messages;
  const next = await t.backend.action(async (ctx) =>
    prepareConversationContext(ctx, {
      ...t.options,
      promptMessageId: followup._id,
      threshold: 1_000_000,
      preserveObjective: (messages) => preserveTurnObjective(messages, followup.text ?? ""),
    }),
  );
  expect(next.compactionId).toBe(first.compactionId);
  expect(next.messages[0]).toEqual(first.messages[0]);
  expect(next.messages.slice(1, -1)).toEqual(first.messages.slice(-8));
  expect(next.messages.at(-1)).toEqual(docsToModelMessages([followup])[0]);
  expect(t.summarize).toHaveBeenCalledTimes(1);
});
