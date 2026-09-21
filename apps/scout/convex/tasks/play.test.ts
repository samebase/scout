/// <reference types="vite/client" />
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { requireRuntimeTool } from "../scout/lib/runtimeTool";
import { insertTestAccount } from "../testing/accounts";
import { taskInstructions } from "./execution";
import { runtimeTools } from "./tools";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup(kind: "play" | "review") {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  const { userId, scoutId } = await backend.run(async (ctx) => ({
    userId: await insertTestAccount(ctx, { email: "member@example.test" }),
    scoutId: await ctx.db.insert("scouts", {
      displayName: "Play Scout",
      websiteIdentity: { firstName: "Play", lastName: "Scout" },
      slug: "play-scout",
      status: "active",
      agentMail: { inboxId: "play", address: "play@example.test" },
      firecrawl: { profileName: "play" },
    }),
  }));
  const member = backend.withIdentity({ subject: userId });
  const { threadId } = await member.mutation(api.scout.chats.startProductChat, {
    selection: { engine: "agents_api", model: "gpt-5.6-luna" },
    product: { kind },
    scoutId,
    prompt: "Play a game of chess",
    visibility: "private",
  });
  const sessionId = await backend.run(async (ctx) => {
    const id = ctx.db.normalizeId("agentsApiSessions", threadId);
    if (!id) throw new Error("Product task session not found");
    await ctx.db.patch(id, {
      state: { kind: "running" },
      browser: {
        providerSessionId: "play-browser",
        cdpUrl: "wss://browser.example.test/cdp",
        interactiveLiveViewUrl: null,
        liveViewUrl: null,
        currentUrl: null,
      },
    });
    return id;
  });
  const instructions = () =>
    backend.action(async (ctx) => {
      const { session, scout, purpose } = await ctx.runQuery(internal.tasks.sessions.runtime, {
        sessionId,
      });
      return taskInstructions(ctx, session, scout, purpose);
    });
  const stepTool = (step: string) =>
    backend.action(async (ctx) => {
      const { session, scout, purpose } = await ctx.runQuery(internal.tasks.sessions.runtime, {
        sessionId,
      });
      const resource = await runtimeTools(ctx, session, scout, "set_activity_step", purpose);
      try {
        return await requireRuntimeTool(resource.tools, "set_activity_step").execute(
          { step },
          { toolCallId: "play-phase", messages: [], context: {} },
        );
      } finally {
        await resource.dispose();
      }
    });
  return { backend, member, sessionId, instructions, stepTool };
}

it("gives Play tasks game instructions and persists each activity phase through the task tool", async () => {
  const t = await setup("play");
  const instructions = await t.instructions();
  expect(instructions).toContain("This is TrailScout Play");
  expect(instructions).toContain("keep playing until you observe a win, loss, draw");
  expect(instructions).toContain("Call set_activity_step");
  expect(instructions).not.toContain("Current activity:");

  for (const step of ["research", "account_setup", "play"] as const) {
    expect(await t.stepTool(step)).toEqual({ step });
    expect(await t.member.query(api.scout.activity.get, { threadId: t.sessionId })).toMatchObject({
      purpose: { kind: "play", step },
    });
  }

  await t.backend.run((ctx) => ctx.db.patch(t.sessionId, { state: { kind: "stopped" } }));
  await expect(t.stepTool("research")).rejects.toThrow("no longer running");
  expect(await t.member.query(api.scout.activity.get, { threadId: t.sessionId })).toMatchObject({
    purpose: { kind: "play", step: "play" },
  });
});

it("keeps Play guidance and activity updates off review tasks", async () => {
  const t = await setup("review");
  expect(await t.instructions()).not.toContain("This is TrailScout Play");
  await expect(t.stepTool("research")).rejects.toThrow("cannot be executed");
  await expect(
    t.backend.mutation(internal.scout.chats.setTaskActivityStep, {
      sessionId: t.sessionId,
      step: "research",
    }),
  ).rejects.toThrow("Play chat not found");
  expect(await t.member.query(api.scout.activity.get, { threadId: t.sessionId })).toMatchObject({
    purpose: { kind: "review" },
  });
});

it("supplies the current saved walkthrough without relying on conversation history", async () => {
  const t = await setup("review");
  expect(await t.instructions()).not.toContain("<scout_walkthrough_context>");
  const walkthrough = {
    summary: "The budget comparison could not be completed.",
    checks: [{ label: "Set budget", result: "untested", explanation: "No control found." }],
    sections: [],
  } satisfies NonNullable<Doc<"agentsApiSessions">["walkthrough"]>;
  await t.backend.run((ctx) => ctx.db.patch(t.sessionId, { walkthrough }));
  const stored = await t.backend.run((ctx) => ctx.db.get(t.sessionId));
  expect(stored?.walkthrough).toEqual(walkthrough);
  expect(await t.instructions()).toContain(JSON.stringify(stored?.walkthrough));

  const revised = {
    ...walkthrough,
    summary: "Activities persisted; the budget remains unverified.",
  };
  await t.backend.run((ctx) => ctx.db.patch(t.sessionId, { walkthrough: revised }));
  const instructions = await t.instructions();
  const updated = await t.backend.run((ctx) => ctx.db.get(t.sessionId));
  expect(updated?.walkthrough).toEqual(revised);
  expect(instructions).toContain(JSON.stringify(updated?.walkthrough));
  expect(instructions).not.toContain(walkthrough.summary);
});
