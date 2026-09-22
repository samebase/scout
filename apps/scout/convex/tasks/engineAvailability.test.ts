/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { expect, it } from "vite-plus/test";
import { api } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};

async function setup() {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const staffId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const memberId = await insertTestAccount(ctx, { email: "member@example.test" });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      slug: "scout",
      status: "active",
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "profile" },
    });
    return { staffId, memberId, scoutId };
  });
  return {
    backend,
    staff: backend.withIdentity({ subject: ids.staffId }),
    member: backend.withIdentity({ subject: ids.memberId }),
    ...ids,
  };
}

it("lets staff pause and resume new Agents API tasks without redeploying", async () => {
  const { backend, staff, member, scoutId } = await setup();
  const args = {
    scoutId,
    prompt: "Try example.com",
    selection: { engine: "agents_api", model: "gpt-5.6-luna" },
  } as const;

  expect(await staff.query(api.tasks.engineSettings.get, {})).toBe(false);
  await expect(member.mutation(api.tasks.engineSettings.set, { enabled: true })).rejects.toThrow();
  expect(await member.query(api.tasks.engineSettings.get, {})).toBe(false);
  await expect(staff.mutation(api.tasks.sessions.start, args)).rejects.toThrow(
    "paused while we investigate unexpected OpenAI charges",
  );
  await expect(
    member.mutation(api.scout.chats.startProductChat, {
      ...args,
      product: { kind: "review" },
      visibility: "public",
    }),
  ).rejects.toThrow("paused while we investigate unexpected OpenAI charges");
  expect(await backend.run((ctx) => ctx.db.query("agentsApiSessions").first())).toBeNull();

  await staff.mutation(api.tasks.engineSettings.set, { enabled: true });
  expect(await member.query(api.tasks.engineSettings.get, {})).toBe(true);
  const sessionId = await staff.mutation(api.tasks.sessions.start, args);
  expect(await backend.run((ctx) => ctx.db.get(sessionId))).toMatchObject({
    engine: "agents_api",
    state: { kind: "starting" },
  });
  await staff.mutation(api.tasks.engineSettings.set, { enabled: false });
  expect(await staff.query(api.tasks.engineSettings.get, {})).toBe(false);
});

it("allows follow-ups on existing Agents API tasks while new starts are paused", async () => {
  const { backend, staff, staffId, scoutId } = await setup();
  const sessionId = await backend.run((ctx) =>
    ctx.db.insert("agentsApiSessions", {
      engine: "agents_api",
      userId: staffId,
      scoutId,
      scoutName: "Scout",
      title: "Existing review",
      model: "gpt-5.6-luna",
      active: false,
      state: { kind: "idle" },
      nextSequence: 0,
      browser: null,
      usage: null,
      providerId: "existing-openai-session",
    }),
  );
  await staff.mutation(api.tasks.engineSettings.set, { enabled: false });
  expect(await staff.query(api.tasks.sessions.controls, { sessionId })).toMatchObject({
    canSend: true,
  });
  await staff.mutation(api.tasks.sessions.send, { sessionId, message: "Continue" });
  expect(await backend.run((ctx) => ctx.db.get(sessionId))).toMatchObject({
    state: { kind: "running" },
    pendingMessage: { message: "Continue", status: "queued" },
  });
});
