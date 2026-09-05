/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { docsToModelMessages } from "@convex-dev/agent";
import type { FunctionArgs } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";
import { omitNullish } from "../shared/omitNullish";
import { loadUncompactedMessages, prepareConversationContext } from "./scout/compactionContext";
import { preserveTurnObjective } from "./scout/generation";
import { estimateContextTokens } from "./scout/modelContext";
import { bundledSkills, createSkillTools } from "./scout/skills";

type StoredMessage = FunctionArgs<
  typeof components.agent.messages.addMessages
>["messages"][number]["message"];

async function setup(objective = "Research these services and draft an email. Do not send it.") {
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

test("keeps skill guidance across slices, compaction and follow-ups without rewriting history", async () => {
  const t = await setup("Play the game until it ends.");
  expect(
    (
      await t.backend.query(internal.scout.chats.runtimeContext, {
        promptMessageId: t.prompt._id,
      })
    ).skillsSelected,
  ).toBe(false);
  const { load_skills: loader } = createSkillTools(async (names) =>
    t.backend.mutation(internal.scout.chats.loadSkills, { turnId: t.turnId, names }),
  );
  const selection = await loader.execute(
    { names: ["games", "games"] },
    { toolCallId: "skills-1", messages: [], context: {} },
  );
  await t.backend.mutation(components.agent.messages.addMessages, {
    threadId: t.threadId,
    promptMessageId: t.prompt._id,
    messages: [
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "skills-1",
              toolName: "load_skills",
              args: { names: ["games"] },
            },
          ],
        },
      },
      {
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "skills-1",
              toolName: "load_skills",
              result: selection,
            },
          ],
        },
      },
    ],
  });
  await t.writeHistory("Game observations", 20, 100);
  const original = await t.readOriginal();
  const compacted = await t.prepare();
  expect(compacted.compactionId).not.toBeNull();
  expect(JSON.stringify(compacted.messages)).not.toContain("load_skills");
  expect(await t.readOriginal()).toEqual(original);
  const runtime = await t.backend.query(internal.scout.chats.runtimeContext, {
    promptMessageId: t.prompt._id,
  });
  expect(runtime.activeSkills).toEqual(["games"]);
  expect(runtime.skillsSelected).toBe(true);
  await t.backend.mutation(internal.scout.turns.continueAfterSlice, {
    promptMessageId: t.prompt._id,
    previousCompletedSteps: 1,
    completedSteps: 2,
    usage: {},
  });
  expect(
    (
      await t.backend.query(internal.scout.chats.runtimeContext, {
        promptMessageId: t.prompt._id,
      })
    ).activeSkills,
  ).toEqual(["games"]);
  const readInstructions = async () =>
    (
      await t.owner.query(api.scout.chats.getThreadAgentContext, {
        threadId: t.threadId,
      })
    ).instructions;
  const instructions = await readInstructions();
  expect(instructions.split(bundledSkills.games.guidance)).toHaveLength(2);
  expect(instructions).not.toContain(bundledSkills.email.guidance);
  expect(instructions).not.toContain(bundledSkills.research.guidance);
  expect(JSON.stringify(t.summarize.mock.calls)).not.toContain(bundledSkills.games.guidance);
  await t.backend.mutation(internal.scout.turns.complete, {
    promptMessageId: t.prompt._id,
    usage: {},
  });
  const [nextPrompt] = (
    await t.backend.mutation(components.agent.messages.addMessages, {
      threadId: t.threadId,
      messages: [{ message: { role: "user", content: "Now research and email the result." } }],
    })
  ).messages;
  const nextTurn = await t.backend.run(async (ctx) => {
    const previous = await ctx.db.get(t.turnId);
    if (!previous) throw new Error("Turn missing");
    const { _id: _previousId, _creationTime: _created, ...fields } = previous;
    return ctx.db.insert("scoutTurns", {
      ...fields,
      skillsSelected: false,
      promptMessageId: nextPrompt._id,
      order: nextPrompt.order,
      state: { kind: "pending", leaseExpiresAt: Date.now() + 60_000, completedSteps: 0, usage: {} },
    });
  });
  expect(
    await t.backend.query(internal.scout.chats.runtimeContext, {
      promptMessageId: nextPrompt._id,
    }),
  ).toMatchObject({ activeSkills: ["games"], skillsSelected: false });
  expect(
    await t.backend.mutation(internal.scout.chats.loadSkills, { turnId: nextTurn, names: null }),
  ).toEqual(["games"]);
  await t.backend.mutation(internal.scout.chats.loadSkills, {
    turnId: nextTurn,
    names: ["email", "research"],
  });
  const switched = await readInstructions();
  expect(switched).not.toContain(bundledSkills.games.guidance);
  expect(switched).toContain(bundledSkills.research.guidance);
  expect(switched).toContain(bundledSkills.email.guidance);
  expect(
    (
      await t.backend.query(internal.scout.chats.runtimeContext, {
        promptMessageId: nextPrompt._id,
      })
    ).skillsSelected,
  ).toBe(true);
  await expect(
    t.backend.mutation(internal.scout.chats.loadSkills, {
      turnId: t.turnId,
      names: ["games"],
    }),
  ).rejects.toThrow("Active Scout turn not found");
  await expect(
    t.outsider.query(api.scout.chats.getThreadAgentContext, { threadId: t.threadId }),
  ).rejects.toThrow();
  expect((await t.readOriginal()).slice(0, original.length)).toEqual(original);
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

test("does not summarize when only the pinned objective is outside the recent window", async () => {
  const t = await setup("Research these sources and compare them. ".padEnd(10_200, "x"));
  await t.writeHistory("Recent source", 8, 1_000);
  const original = await t.readOriginal();
  const prepared = await t.prepare();
  expect(prepared.messages).toEqual(docsToModelMessages(original));
  expect(t.summarize).not.toHaveBeenCalled();
  expect(prepared.compactionId).toBeNull();
});

test("compacts later research after a large prefix of superseded browser snapshots", async () => {
  const t = await setup();
  const history: StoredMessage[] = [];
  for (let index = 0; index < 12; index += 1) {
    const toolCallId = `browser-${index}`;
    history.push(
      {
        role: "assistant",
        content: [{ type: "tool-call", toolName: "browser_execute", toolCallId, input: {} }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "browser_execute",
            toolCallId,
            output: { type: "json", value: { currentPage: "snapshot".repeat(2_500) } },
          },
        ],
      },
    );
  }
  await t.backend.mutation(components.agent.messages.addMessages, {
    threadId: t.threadId,
    promptMessageId: t.prompt._id,
    messages: history.map((message) => ({ message })),
  });
  await t.writeHistory("Research source", 20, 1_000);
  const original = await t.readOriginal();
  const beforeTokens = estimateContextTokens(docsToModelMessages(original));
  const prepared = await t.prepare();
  expect(t.summarize).toHaveBeenCalled();
  expect(prepared.compactionId).not.toBeNull();
  expect(estimateContextTokens(prepared.messages)).toBeLessThan(beforeTokens / 2);
  expect(prepared.messages.slice(-8)).toEqual(docsToModelMessages(original.slice(-8)));
  expect(await t.readOriginal()).toEqual(original);
  const summaryCount = t.summarize.mock.calls.length;
  expect(await t.prepare()).toEqual(prepared);
  expect(t.summarize).toHaveBeenCalledTimes(summaryCount);
});

test("does not lose a manual result arriving after a later turn starts compacting", async () => {
  const t = await setup();
  const add = async (messages: StoredMessage[], promptMessageId: string | null) =>
    (
      await t.backend.mutation(components.agent.messages.addMessages, {
        threadId: t.threadId,
        ...omitNullish({ promptMessageId }),
        messages: messages.map((message) => ({ message })),
      })
    ).messages;
  const call: StoredMessage = {
    role: "assistant",
    content: [{ type: "tool-call", toolName: "web_crawl", toolCallId: "late-result", input: {} }],
  };
  await add([call], t.prompt._id);
  const objective = "Continue the other research.";
  const [current] = await add([{ role: "user", content: objective }], null);
  await t.backend.run(async (ctx) =>
    ctx.db.patch(t.turnId, {
      promptMessageId: current._id,
      order: current.order,
    }),
  );
  await add(
    Array.from({ length: 20 }, (_, index) => ({
      role: "assistant" as const,
      content: "Source " + index + ": " + "Evidence about another source. ".repeat(100),
    })),
    current._id,
  );
  const prepare = (threshold: number) =>
    t.backend.action(async (ctx) =>
      prepareConversationContext(ctx, {
        ...t.options,
        promptMessageId: current._id,
        threshold,
        preserveObjective: (messages) => preserveTurnObjective(messages, objective),
      }),
    );
  await prepare(9_000);
  const result: StoredMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolName: "web_crawl",
        toolCallId: "late-result",
        output: { type: "text", value: "The delayed source contains the required answer." },
      },
    ],
  };
  await add([result], t.prompt._id);
  const original = await t.readOriginal();
  expect(docsToModelMessages(original)).toContainEqual(result);
  const resumed = await prepare(1_000_000);
  expect(resumed.messages).toContainEqual(call);
  expect(resumed.messages).toContainEqual(result);
  const compacted = await prepare(9_000);
  expect(compacted.compactionId).not.toBeNull();
  expect(t.summarize.mock.calls[0][0].messages).toContainEqual(result);
  expect(await t.readOriginal()).toEqual(original);
});
