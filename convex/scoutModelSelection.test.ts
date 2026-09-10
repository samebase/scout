/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";

const modules = import.meta.glob("./**/*.ts");
const qwen = { model: "qwen/qwen3.7-flash" } as const;
const lunaMax = { model: "openai/gpt-5.6-luna", reasoningEffort: "max" } as const;
const lunaHigh = { model: "openai/gpt-5.6-luna", reasoningEffort: "high" } as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const { userId, otherId, scoutId } = await backend.run(async (ctx) => ({
    userId: await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
    otherId: await insertTestAccount(ctx, { email: "nicu@samebase.com" }),
    scoutId: await ctx.db.insert("scouts", {
      displayName: "Model Test Scout",
      websiteIdentity: { firstName: "Model", lastName: "Test" },
      slug: "model-test",
      status: "active",
      agentMail: { inboxId: "model-test", address: "model@example.test" },
      firecrawl: { profileName: "model-test" },
    }),
  }));
  const owner = backend.withIdentity({ subject: `${userId}|test-session` });
  const other = backend.withIdentity({ subject: `${otherId}|test-session` });
  const { threadId } = await owner.mutation(api.scout.chats.createThread, { scoutId });
  return { backend, owner, other, scoutId, threadId, userId };
}

test("saves each chat choice immediately and copies the user default only when creating a chat", async () => {
  const t = await setup();
  expect(await t.owner.query(api.scout.chats.getModelSelection, { threadId: t.threadId })).toEqual(
    lunaMax,
  );
  await t.owner.mutation(api.scout.chats.setModelSelection, {
    threadId: t.threadId,
    selection: lunaHigh,
  });
  const freshSession = t.backend.withIdentity({ subject: `${t.userId}|fresh-session` });
  expect(
    await freshSession.query(api.scout.chats.getModelSelection, { threadId: t.threadId }),
  ).toEqual(lunaHigh);
  expect(await freshSession.query(api.scout.chats.getModelSelection, { threadId: null })).toEqual(
    lunaHigh,
  );
  expect(
    await t.backend.run(async (ctx) =>
      ctx.db
        .query("scoutTurns")
        .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", t.threadId))
        .first(),
    ),
  ).toBeNull();

  const second = await t.owner.mutation(api.scout.chats.createThread, { scoutId: t.scoutId });
  expect(await t.owner.query(api.scout.chats.getModelSelection, second)).toEqual(lunaHigh);
  await t.owner.mutation(api.scout.chats.setModelSelection, {
    threadId: second.threadId,
    selection: qwen,
  });
  expect(await t.owner.query(api.scout.chats.getModelSelection, { threadId: t.threadId })).toEqual(
    lunaHigh,
  );
  expect(await t.owner.query(api.scout.chats.getModelSelection, { threadId: null })).toEqual(qwen);
  const third = await t.owner.mutation(api.scout.chats.createThread, { scoutId: t.scoutId });
  expect(await t.owner.query(api.scout.chats.getModelSelection, third)).toEqual(qwen);
});

test("sends with the saved choice and remembers explicit turn selections without changing the new-chat default", async () => {
  const t = await setup();
  await t.owner.mutation(api.scout.chats.setModelSelection, {
    threadId: null,
    selection: lunaHigh,
  });
  const play = await t.owner.mutation(api.scout.chats.createThread, {
    scoutId: t.scoutId,
    purpose: "play",
  });
  await t.owner.mutation(api.scout.chats.sendMessage, { ...play, prompt: "Hello" });
  const turn = await t.backend.run(async (ctx) =>
    ctx.db
      .query("scoutTurns")
      .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", play.threadId))
      .first(),
  );
  expect(turn).toMatchObject(lunaHigh);
  if (!turn) throw new Error("Turn missing");
  await t.owner.mutation(internal.scout.turns.complete, {
    promptMessageId: turn.promptMessageId,
    usage: {},
  });
  await t.owner.mutation(api.scout.chats.sendMessage, {
    ...play,
    prompt: "Switch this chat",
    selection: qwen,
  });
  expect(await t.owner.query(api.scout.chats.getModelSelection, play)).toEqual(qwen);
  expect(await t.owner.query(api.scout.chats.getModelSelection, { threadId: null })).toEqual(
    lunaHigh,
  );
  expect(await t.owner.query(api.scout.chats.getModelSelection, { threadId: t.threadId })).toEqual(
    lunaMax,
  );
});

test("restores existing chats from the latest turn until a picker choice overrides it", async () => {
  const t = await setup();
  await t.backend.run(async (ctx) => {
    const chat = await ctx.db
      .query("scoutChats")
      .withIndex("by_thread_id", (q) => q.eq("threadId", t.threadId))
      .unique();
    if (!chat) throw new Error("Chat missing");
    await ctx.db.patch(chat._id, { modelSelection: undefined });
    for (const [order, selection] of [lunaMax, qwen].entries()) {
      await ctx.db.insert("scoutTurns", {
        threadId: t.threadId,
        scoutId: t.scoutId,
        promptMessageId: `historical-prompt-${order}`,
        order,
        startedAt: order,
        ...selection,
        state: { kind: "completed", completedAt: order + 1, usage: {} },
      });
    }
  });
  expect(await t.owner.query(api.scout.chats.getModelSelection, { threadId: t.threadId })).toEqual(
    qwen,
  );
  expect(await t.owner.query(api.scout.chats.getModelSelection, { threadId: null })).toEqual(
    lunaMax,
  );
  const lunaDefault = { model: "openai/gpt-5.6-luna" } as const;
  await t.owner.mutation(api.scout.chats.setModelSelection, {
    threadId: t.threadId,
    selection: lunaDefault,
  });
  expect(await t.owner.query(api.scout.chats.getModelSelection, { threadId: t.threadId })).toEqual(
    lunaDefault,
  );
});

test("isolates account defaults and rejects another user's chat or an unsupported effort", async () => {
  const t = await setup();
  await t.owner.mutation(api.scout.chats.setModelSelection, {
    threadId: t.threadId,
    selection: qwen,
  });
  expect(await t.other.query(api.scout.chats.getModelSelection, { threadId: null })).toEqual(
    lunaMax,
  );
  await expect(
    t.other.query(api.scout.chats.getModelSelection, { threadId: t.threadId }),
  ).rejects.toThrow("Thread not found");
  await expect(
    t.other.mutation(api.scout.chats.setModelSelection, {
      threadId: t.threadId,
      selection: lunaHigh,
    }),
  ).rejects.toThrow("Thread not found");
  const unsupported = { model: "qwen/qwen3.7-flash", reasoningEffort: "max" } as const;
  await expect(
    t.owner.mutation(api.scout.chats.setModelSelection, {
      threadId: t.threadId,
      selection: unsupported,
    }),
  ).rejects.toThrow();
  expect(await t.owner.query(api.scout.chats.getModelSelection, { threadId: t.threadId })).toEqual(
    qwen,
  );
  expect(await t.other.query(api.scout.chats.getModelSelection, { threadId: null })).toEqual(
    lunaMax,
  );
});
