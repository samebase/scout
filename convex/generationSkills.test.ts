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

async function setup(responses: LanguageModelV4StreamPart[][]) {
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
  const { threadId } = await owner.mutation(api.scout.chats.createThread, { scoutId });
  const startTurn = async (content: string) => {
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
        model: "qwen/qwen3.7-flash",
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
          model: "qwen/qwen3.7-flash",
        }),
      state: () => backend.run(async (ctx) => (await ctx.db.get(turnId))?.state),
    };
  };
  return { backend, model, startTurn };
}

function reply(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: "text-start", id: "reply" },
    { type: "text-delta", id: "reply", delta: text },
    { type: "text-end", id: "reply" },
  ];
}

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
