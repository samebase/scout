/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import { api } from "./_generated/api";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const ownerId = await insertTestAccount(ctx, { email: "owner@example.com" });
    const memberId = await insertTestAccount(ctx, { email: "member@example.com" });
    const adminId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Conrad",
      websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
      slug: "conrad",
      status: "active",
      agentMail: { inboxId: "inbox", address: "conrad@example.com" },
      firecrawl: { profileName: "conrad" },
    });
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      userId: ownerId,
      scoutId,
      scoutName: "Conrad",
      title: "Test Samebase signup",
      model: "test",
      state: { kind: "waiting", message: "Private handoff reason", callId: "call", turnId: "turn" },
      active: true,
      nextSequence: 0,
      browser: null,
      usage: null,
    });
    const chatId = await ctx.db.insert("scoutChats", {
      userId: ownerId,
      scoutId,
      threadId: sessionId,
      purpose: { kind: "review" },
      visibility: "private",
      primarySite: "samebase.com",
      runtime: { kind: "agents_api", sessionId },
      createdAt: 1,
    });
    return { scoutId, sessionId, chatId, ownerId, memberId, adminId };
  });
  return {
    backend,
    ...ids,
    owner: backend.withIdentity({ subject: ids.ownerId }),
    member: backend.withIdentity({ subject: ids.memberId }),
    admin: backend.withIdentity({ subject: ids.adminId }),
  };
}

test("shows the reservation consistently and hides another member's private activity", async () => {
  const t = await setup();
  expect(await t.backend.query(api.scout.activity.players, {})).toMatchObject([
    { busy: true, availability: "waiting" },
  ]);
  const publicScout = {
    _id: t.scoutId,
    displayName: "Conrad",
    websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
    slug: "conrad",
    status: "active",
    availability: "waiting",
    currentActivity: { kind: "private" },
    agentMail: null,
  };
  expect(await t.backend.query(api.scout.scouts.get, { slug: "conrad" })).toEqual(publicScout);
  expect(await t.backend.query(api.scout.scouts.list, {})).toEqual([publicScout]);
  expect(await t.member.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    status: "active",
    availability: "waiting",
    currentActivity: { kind: "private" },
  });
  const memberList = await t.member.query(api.scout.scouts.list, {});
  expect(memberList[0]?.currentActivity).toEqual({ kind: "private" });
  expect(JSON.stringify(memberList)).not.toContain("Samebase");
  expect(JSON.stringify(memberList)).not.toContain(t.sessionId);
  expect(await t.owner.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    currentActivity: {
      kind: "visible",
      activity: { title: "Test Samebase signup" },
      destination: { to: "/tasks/$thread", params: { thread: t.sessionId } },
    },
  });
  expect(await t.admin.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    currentActivity: {
      kind: "visible",
      destination: { to: "/agents", search: { session: t.sessionId } },
    },
  });
});

test("shows a public review to members but hides an unapproved public request", async () => {
  const t = await setup();
  await t.backend.run((ctx) => ctx.db.patch(t.chatId, { visibility: "public" }));
  expect(await t.member.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    currentActivity: { kind: "private" },
  });
  const checkId = await t.backend.run((ctx) =>
    ctx.db.insert("agentsApiRequestChecks", {
      kind: "initial",
      sessionId: t.sessionId,
      model: "test",
      prompt: "unsafe request",
      state: { kind: "pending" },
    }),
  );
  expect(await t.member.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    currentActivity: { kind: "private" },
  });
  await t.backend.run((ctx) =>
    ctx.db.patch(checkId, {
      state: {
        kind: "completed",
        finishedAt: 1,
        call: { startedAt: 0, request: "{}", response: "{}", usage: null },
        result: {
          kind: "initial",
          title: "Test Samebase signup",
          decision: { kind: "approved" },
        },
      },
    }),
  );
  expect(await t.member.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    currentActivity: { kind: "visible", activity: { primarySite: "samebase.com" } },
  });
});

test("keeps a stopping Scout reserved until cleanup releases it", async () => {
  const t = await setup();
  await t.backend.run((ctx) => ctx.db.patch(t.sessionId, { state: { kind: "stopped" } }));
  expect(await t.member.query(api.scout.scouts.list, {})).toMatchObject([
    { availability: "stopping" },
  ]);
  expect(await t.backend.query(api.scout.activity.players, {})).toMatchObject([{ busy: true }]);
  await t.backend.run((ctx) => ctx.db.patch(t.sessionId, { active: false }));
  expect(await t.member.query(api.scout.scouts.list, {})).toMatchObject([
    { availability: "available", currentActivity: null },
  ]);
  expect(await t.backend.query(api.scout.activity.players, {})).toMatchObject([
    { availability: "available", busy: false },
  ]);
});

test("reserves a checking Scout as working while preserving private activity access", async () => {
  const t = await setup();
  const checkId = await t.backend.run(async (ctx) => {
    const checkId = await ctx.db.insert("agentsApiRequestChecks", {
      kind: "resume",
      sessionId: t.sessionId,
      model: "test",
      prompt: "Test signup",
      handoff: { callId: "call", turnId: "turn", message: "Private handoff reason" },
      providerSessionId: "browser",
      evidence: null,
      state: { kind: "pending" },
    });
    await ctx.db.patch(t.sessionId, { state: { kind: "checking", checkId } });
    return checkId;
  });
  expect(await t.backend.query(api.scout.activity.players, {})).toMatchObject([
    { busy: true, availability: "working" },
  ]);
  expect(await t.member.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    availability: "working",
    currentActivity: { kind: "private" },
  });
  expect(await t.owner.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    availability: "working",
    currentActivity: { kind: "visible" },
  });
  expect(JSON.stringify(await t.member.query(api.scout.scouts.list, {}))).not.toContain(checkId);
});

test("links a standalone Agents session for an admin without exposing it to members", async () => {
  const t = await setup();
  await t.backend.run((ctx) => ctx.db.delete(t.chatId));
  expect(await t.admin.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    currentActivity: {
      kind: "visible",
      activity: { title: "Test Samebase signup" },
      destination: { to: "/agents", search: { session: t.sessionId } },
    },
  });
  expect(await t.member.query(api.scout.scouts.get, { slug: "conrad" })).toMatchObject({
    currentActivity: { kind: "private" },
  });
});
