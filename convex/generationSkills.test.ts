import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import * as models from "./scout/models";
import { omitNullish } from "../shared/omitNullish";
import { bundledSkills } from "./scout/skills";

vi.mock("@ai-sdk/mcp", async () => {
  const { tool } = await import("ai");
  const { z } = await import("zod");
  const unusedMailTool = tool({
    inputSchema: z.object({}),
    execute: async (): Promise<string> => {
      throw new Error("Unexpected mail call");
    },
    toModelOutput: () => ({ type: "text", value: "Unused" }),
  });
  return {
    createMCPClient: async () => ({
      listTools: async () => ({ tools: [] }),
      toolsFromDefinitions: () => ({
        list_messages: unusedMailTool,
        search_messages: unusedMailTool,
        get_thread: unusedMailTool,
      }),
      close: async () => {},
    }),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function setup(responses: LanguageModelV4StreamPart[][], purpose?: "play") {
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl");
  vi.stubEnv("AGENTMAIL_API_KEY", "test-agentmail");
  const model = new MockLanguageModelV4({
    doStream: responses.map((parts) => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        ...parts,
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
        },
      ]),
    })),
  });
  vi.spyOn(models, "scoutLanguageModel").mockReturnValue(model);
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  agentTest.register(backend);
  const { userId, scoutId } = await backend.run(async (ctx) => ({
    userId: await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
    scoutId: await ctx.db.insert("scouts", {
      displayName: "Skill test Scout",
      slug: "skill-test",
      websiteIdentity: { firstName: "Skill", lastName: "Scout" },
      status: "active",
      agentMail: { inboxId: "test", address: "test@example.test" },
      firecrawl: { profileName: "test" },
    }),
  }));
  const owner = backend.withIdentity({ subject: `${userId}|session` });
  const { threadId } = await owner.mutation(api.scout.chats.createThread, {
    scoutId,
    ...omitNullish({ purpose }),
  });
  const startTurn = async (
    content: string,
    selection: models.ScoutModelSelection = { model: "qwen/qwen3.7-flash" },
  ) => {
    const {
      messages: [prompt],
    } = await backend.mutation(components.agent.messages.addMessages, {
      threadId,
      messages: [{ message: { role: "user", content } }],
    });
    const turnId = await backend.run(async (ctx) =>
      ctx.db.insert("scoutTurns", {
        threadId,
        promptMessageId: prompt._id,
        order: prompt.order,
        scoutId,
        ...selection,
        startedAt: Date.now(),
        state: {
          kind: "pending",
          leaseExpiresAt: Date.now() + 60_000,
          completedSteps: 0,
          usage: {},
        },
      }),
    );
    return {
      turnId,
      run: () =>
        backend.action(internal.scout.generation.runSlice, {
          threadId,
          userId,
          promptMessageId: prompt._id,
          model: selection.model,
        }),
      state: () => backend.run(async (ctx) => (await ctx.db.get(turnId))?.state),
    };
  };
  return { backend, model, startTurn, owner, threadId };
}

function reply(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: "text-start", id: "reply" },
    { type: "text-delta", id: "reply", delta: text },
    { type: "text-end", id: "reply" },
  ];
}

test.each(["none", "max"] as const)(
  "keeps Luna %s effort across generation slices",
  async (effort) => {
    const t = await setup([
      [
        {
          type: "tool-call",
          toolCallId: "skills-1",
          toolName: "load_skills",
          input: '{"names":["research"]}',
        },
      ],
      reply("Done."),
    ]);
    const turn = await t.startTurn("Compare the findings.", {
      model: "openai/gpt-5.6-luna",
      reasoningEffort: effort,
    });
    await expect(turn.run()).resolves.toEqual({ kind: "continued" });
    await expect(turn.run()).resolves.toEqual({ kind: "completed" });
    expect(t.model.doStreamCalls).toHaveLength(2);
    for (const call of t.model.doStreamCalls) {
      expect(call.providerOptions).toEqual({ convexGateway: { reasoningEffort: effort } });
    }
    const calls = await t.backend.run(async (ctx) =>
      ctx.db
        .query("scoutModelCalls")
        .withIndex("by_turn_id_and_sequence", (q) => q.eq("turnId", turn.turnId))
        .take(10),
    );
    for (const call of calls) {
      const snapshot = await t.backend.run(async (ctx) => {
        const blob = await ctx.storage.get(call.snapshotStorageId);
        if (!blob) throw new Error("Model input snapshot was not saved");
        return await blob.text();
      });
      expect(JSON.parse(snapshot).settings.reasoningEffort).toBe(effort);
    }
  },
);

test("leaves Luna reasoning unset for Default", async () => {
  const t = await setup([reply("Done.")]);
  const turn = await t.startTurn("Compare the findings.", { model: "openai/gpt-5.6-luna" });
  await turn.run();
  expect(t.model.doStreamCalls[0].providerOptions?.["convexGateway"]).toBeUndefined();
});

test("continues task execution after a successful skill call with stop finish reason", async () => {
  const t = await setup([
    [
      {
        type: "tool-call",
        toolCallId: "skills-1",
        toolName: "load_skills",
        input: '{"names":["research"]}',
      },
    ],
    reply("The comparison is complete."),
  ]);
  const turn = await t.startTurn("Compare the supplied research findings.");

  await expect(turn.run()).resolves.toEqual({ kind: "continued" });
  expect(await turn.state()).toMatchObject({ kind: "pending", completedSteps: 1 });
  await expect(turn.run()).resolves.toEqual({ kind: "completed" });
  expect(await turn.state()).toMatchObject({ kind: "completed" });
  expect(t.model.doStreamCalls).toHaveLength(2);
  const nextPrompt = JSON.stringify(t.model.doStreamCalls[1].prompt);
  expect(nextPrompt).toContain("load_skills");
  expect(nextPrompt).toContain("activeSkills");
  expect(nextPrompt).toContain(JSON.stringify(bundledSkills.research.guidance).slice(1, -1));
});

test("starts directly, retains guides on follow-ups, and switches or clears them when requested", async () => {
  const t = await setup([
    reply("4"),
    [
      {
        type: "tool-call",
        toolCallId: "games",
        toolName: "load_skills",
        input: '{"names":["games"]}',
      },
    ],
    reply("1. Your turn."),
    reply("3. Your turn."),
    [
      {
        type: "tool-call",
        toolCallId: "email",
        toolName: "load_skills",
        input: '{"names":["email"]}',
      },
    ],
    reply("Subject: Meeting\nCan we meet tomorrow?"),
    [{ type: "tool-call", toolCallId: "clear", toolName: "load_skills", input: '{"names":[]}' }],
    reply("4"),
  ]);
  const simple = await t.startTurn("What is 2 + 2?");
  await expect(simple.run()).resolves.toEqual({ kind: "completed" });
  expect(t.model.doStreamCalls).toHaveLength(1);
  expect(t.model.doStreamCalls[0].toolChoice).toEqual({ type: "auto" });
  expect(t.model.doStreamCalls[0].tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "load_skills" }),
      expect.objectContaining({ name: "browser_execute" }),
    ]),
  );
  expect(t.model.doStreamCalls[0].tools).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "keep_skills" })]),
  );

  const game = await t.startTurn("Let's take turns counting to 7. Start at 1.");
  await expect(game.run()).resolves.toEqual({ kind: "continued" });
  await expect(game.run()).resolves.toEqual({ kind: "completed" });
  const move = await t.startTurn("2");
  await expect(move.run()).resolves.toEqual({ kind: "completed" });
  expect(t.model.doStreamCalls).toHaveLength(4);

  const email = await t.startTurn("Stop the game. Draft a meeting invitation. Do not send it.");
  await expect(email.run()).resolves.toEqual({ kind: "continued" });
  await expect(email.run()).resolves.toEqual({ kind: "completed" });
  const clear = await t.startTurn("Clear the guides. What is 2 + 2?");
  await expect(clear.run()).resolves.toEqual({ kind: "continued" });
  await expect(clear.run()).resolves.toEqual({ kind: "completed" });

  const expectedGuides = [[], [], ["games"], ["games"], ["games"], ["email"], ["email"], []];
  expect(t.model.doStreamCalls).toHaveLength(expectedGuides.length);
  for (const [index, call] of t.model.doStreamCalls.entries()) {
    const prompt = JSON.stringify(call.prompt);
    for (const [name, guide] of Object.entries(bundledSkills)) {
      const body = JSON.stringify(guide.guidance).slice(1, -1);
      expect(prompt.split(body)).toHaveLength(expectedGuides[index].includes(name) ? 2 : 1);
    }
  }
});

test("persists Play activity through slices and follow-ups without rewriting the transcript", async () => {
  const t = await setup(
    [
      [
        {
          type: "tool-call",
          toolCallId: "activity-1",
          toolName: "set_activity_step",
          input: '{"step":"research"}',
        },
      ],
      reply("We can play without an account. Here are the rules."),
      [
        {
          type: "tool-call",
          toolCallId: "activity-2",
          toolName: "set_activity_step",
          input: '{"step":"play"}',
        },
      ],
      reply("I'll take blue. Your turn."),
    ],
    "play",
  );
  const turn = await t.startTurn("Help me learn this game.");
  await expect(turn.run()).resolves.toEqual({ kind: "continued" });
  const threads = () =>
    t.owner.query(api.scout.chats.listThreads, { paginationOpts: { cursor: null, numItems: 10 } });
  expect((await threads()).page[0].play).toEqual({ step: "research" });
  await expect(turn.run()).resolves.toEqual({ kind: "completed" });
  expect(JSON.stringify(t.model.doStreamCalls[1].prompt)).toContain("Current activity: research");
  expect((await threads()).page[0].play).toEqual({ step: "research" });
  const followup = await t.startTurn("Let's play now.");
  await expect(followup.run()).resolves.toEqual({ kind: "continued" });
  expect((await threads()).page[0].play).toEqual({ step: "play" });
  await expect(followup.run()).resolves.toEqual({ kind: "completed" });
  const messages = await t.owner.query(api.scout.chats.listMessages, {
    threadId: t.threadId,
    paginationOpts: { cursor: null, numItems: 50 },
  });
  expect(
    messages.page.filter((message) => message.role === "user").map((message) => message.text),
  ).toEqual(["Help me learn this game.", "Let's play now."]);
  expect(
    messages.page.some((message) => JSON.stringify(message.parts).includes("set_activity_step")),
  ).toBe(true);
  const context = await t.owner.query(api.scout.chats.getThreadAgentContext, {
    threadId: t.threadId,
  });
  expect(context.instructions).toContain("Current activity: play");
  await expect(
    t.backend.mutation(internal.scout.chats.setActivityStep, {
      turnId: turn.turnId,
      step: "account_setup",
    }),
  ).rejects.toThrow("Active Scout turn not found");
});

test("Play tools and scope are absent from ordinary Lab chats", async () => {
  const t = await setup([reply("4")]);
  const turn = await t.startTurn("What is 2 + 2?");
  await turn.run();
  expect(t.model.doStreamCalls[0].tools).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "set_activity_step" })]),
  );
  expect(JSON.stringify(t.model.doStreamCalls[0].prompt)).not.toContain("This is Scout Play.");
});

test("only a live Play turn can change its activity", async () => {
  const lab = await setup([]);
  const labTurn = await lab.startTurn("Hello");
  await expect(
    lab.backend.mutation(internal.scout.chats.setActivityStep, {
      turnId: labTurn.turnId,
      step: "play",
    }),
  ).rejects.toThrow("Play chat not found");
  const t = await setup([], "play");
  const turn = await t.startTurn("Let's play");
  await t.backend.run(async (ctx) => {
    const doc = await ctx.db.get(turn.turnId);
    if (!doc || doc.state.kind !== "pending") throw new Error("Missing pending turn");
    await ctx.db.patch(doc._id, { state: { ...doc.state, leaseExpiresAt: Date.now() - 1 } });
  });
  await expect(
    t.backend.mutation(internal.scout.chats.setActivityStep, { turnId: turn.turnId, step: "play" }),
  ).rejects.toThrow("Active Scout turn not found");
});
