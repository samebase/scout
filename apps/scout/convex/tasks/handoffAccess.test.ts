/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { insertTestAccount } from "../testing/accounts";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};
const minute = 60_000;
const handoff = { callId: "help", turnId: "turn", message: "Complete verification" };
const accessToken = `hh1_${"a".repeat(43)}`;
const tokenHash = createHash("sha256").update(accessToken).digest("hex");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-09-19T12:00:00Z"));
  vi.stubEnv("CREDITS_ENABLED", "false");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup(engine: NonNullable<Doc<"agentsApiSessions">["engine"]>) {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: "owner@example.test" });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "profile" },
    });
    const session = {
      userId,
      scoutId,
      engine,
      scoutName: "Scout",
      title: "Test",
      model: "gpt-5.6-luna",
      active: true,
      state: { kind: "running" },
      browser: null,
      usage: null,
      nextSequence: 0,
    } satisfies Omit<Doc<"agentsApiSessions">, "_id" | "_creationTime">;
    const sessionId = await ctx.db.insert("agentsApiSessions", session);
    const otherSessionId = await ctx.db.insert("agentsApiSessions", session);
    await ctx.db.insert("agentsApiRequestChecks", {
      kind: "initial",
      sessionId,
      model: session.model,
      prompt: "Test example.com",
      state: { kind: "pending" },
    });
    await ctx.db.insert("scoutChats", {
      userId,
      scoutId,
      threadId: sessionId,
      createdAt: Date.now(),
      purpose: { kind: "review" },
      visibility: "private",
      runtime: { kind: "agents_api", sessionId },
    });
    return { sessionId, otherSessionId, userId };
  });
  const browser = {
    providerSessionId: "browser",
    providerExpiresAtMs: Date.now() + 20 * minute,
    cdpUrl: "wss://example.test/private-cdp",
    liveViewUrl: null,
    interactiveLiveViewUrl: "https://liveview.firecrawl.dev/browser/control",
    currentUrl: null,
  };
  await backend.mutation(internal.tasks.browsers.open, { sessionId: ids.sessionId, browser });
  await backend.mutation(internal.tasks.sessions.enterHandoff, {
    sessionId: ids.sessionId,
    ...handoff,
  });
  const access = {
    callId: handoff.callId,
    turnId: handoff.turnId,
    providerSessionId: browser.providerSessionId,
    expiresAt: browser.providerExpiresAtMs,
    tokenHash,
  };
  expect(
    await backend.mutation(internal.tasks.handoffRecords.issue, {
      sessionId: ids.sessionId,
      access,
    }),
  ).toBe(true);
  return {
    ...ids,
    backend,
    browser,
    access,
    args: { sessionId: ids.sessionId, accessToken },
    owner: backend.withIdentity({ subject: ids.userId }),
    read: () => backend.run((ctx) => ctx.db.get(ids.sessionId)),
    checks: () =>
      backend.run((ctx) =>
        ctx.db
          .query("agentsApiRequestChecks")
          .withIndex("by_session_id_and_kind", (q) =>
            q.eq("sessionId", ids.sessionId).eq("kind", "resume"),
          )
          .order("asc")
          .take(10),
      ),
  };
}

describe.each(["agents_api", "convex_agent"] as const)("%s handoff access", (engine) => {
  it("lets an anonymous token holder use the browser and starts only one Resume check", async () => {
    const t = await setup(engine);
    expect(await t.backend.action(api.tasks.handoff.load, t.args)).toEqual({
      status: "waiting",
      scoutName: "Scout",
      expiresAt: t.access.expiresAt,
      serverNow: Date.now(),
      message: handoff.message,
      interactiveLiveViewUrl: t.browser.interactiveLiveViewUrl,
      checkMessage: null,
    });
    expect(await t.checks()).toEqual([]);
    const checking = {
      status: "checking",
      scoutName: "Scout",
      expiresAt: t.access.expiresAt,
      serverNow: Date.now(),
    };
    expect(await t.backend.action(api.tasks.handoff.resume, t.args)).toEqual(checking);
    const session = await t.read();
    expect(session?.state.kind).toBe("checking");
    expect(session?.workflowId).toBeDefined();
    expect(await t.backend.action(api.tasks.handoff.resume, t.args)).toEqual(checking);
    expect(await t.backend.action(api.tasks.handoff.load, t.args)).toEqual(checking);
    expect(await t.checks()).toMatchObject([
      {
        kind: "resume",
        prompt: "Test example.com",
        providerSessionId: t.browser.providerSessionId,
        handoff: { ...handoff, expiresAt: t.access.expiresAt },
        state: { kind: "pending" },
      },
    ]);
    expect((await t.read())?.workflowId).toBe(session?.workflowId);
  });

  it("returns no handoff data for malformed, incorrect, or wrong-session credentials", async () => {
    const t = await setup(engine);
    for (const args of [
      { ...t.args, accessToken: "invalid" },
      { ...t.args, accessToken: `hh1_${"b".repeat(43)}` },
      { ...t.args, sessionId: "invalid" },
      { ...t.args, sessionId: t.otherSessionId },
    ]) {
      expect(await t.backend.action(api.tasks.handoff.load, args)).toEqual({ status: "invalid" });
      expect(await t.backend.action(api.tasks.handoff.resume, args)).toEqual({ status: "invalid" });
    }
    expect((await t.read())?.state.kind).toBe("waiting");
    expect(await t.checks()).toEqual([]);
  });

  it("returns a null diagnostic for a failure without provider details", async () => {
    const t = await setup(engine);
    await t.backend.mutation(internal.tasks.sessions.update, {
      sessionId: t.sessionId,
      state: { kind: "failed", error: "Resume was cancelled" },
    });
    for (const action of [api.tasks.handoff.load, api.tasks.handoff.resume]) {
      expect(await t.backend.action(action, t.args)).toEqual({
        status: "failed",
        error: "Resume was cancelled",
        diagnostic: null,
      });
    }
  });

  it.each([
    ["stopped", "stopped"],
    ["deadline", "expired"],
    ["new handoff", "invalid"],
    ["replaced browser", "stopped"],
  ] as const)("denies the old token after %s", async (change, status) => {
    const t = await setup(engine);
    switch (change) {
      case "stopped":
        await t.owner.mutation(api.tasks.sessions.stop, { sessionId: t.sessionId });
        break;
      case "deadline":
        vi.setSystemTime(t.access.expiresAt);
        break;
      case "new handoff":
        await t.backend.mutation(internal.tasks.sessions.update, {
          sessionId: t.sessionId,
          state: { kind: "running" },
        });
        await t.backend.mutation(internal.tasks.sessions.enterHandoff, {
          sessionId: t.sessionId,
          ...handoff,
          callId: "next-help",
          turnId: "next-turn",
        });
        expect((await t.read())?.handoffAccess).toBeUndefined();
        break;
      case "replaced browser":
        await t.backend.mutation(internal.tasks.sessions.update, {
          sessionId: t.sessionId,
          browser: { ...t.browser, providerSessionId: "replacement" },
        });
        break;
    }
    expect(await t.backend.action(api.tasks.handoff.load, t.args)).toEqual({ status });
    expect(await t.backend.action(api.tasks.handoff.resume, t.args)).toEqual({ status });
    expect(await t.checks()).toEqual([]);
    expect(
      await t.backend.mutation(internal.tasks.handoffRecords.issue, {
        sessionId: t.sessionId,
        access: t.access,
      }),
    ).toBe(false);
    if (change === "deadline") {
      expect((await t.read())?.state).toEqual({ kind: "stopped", reason: "handoff_expired" });
    }
  });

  it.each(["rejected", "failed"] as const)(
    "shows the actual %s check message and retries within the original deadline",
    async (outcome) => {
      const t = await setup(engine);
      await t.backend.action(api.tasks.handoff.resume, t.args);
      const [check] = await t.checks();
      if (!check) throw new Error("Expected Resume check");
      expect(
        await t.backend.mutation(internal.tasks.requestChecks.start, {
          checkId: check._id,
          request: "{}",
          startedAt: Date.now(),
          evidence: { capturedAt: Date.now(), pages: [] },
        }),
      ).toBe(true);
      vi.setSystemTime(Date.now() + 5 * minute);
      const message =
        outcome === "rejected"
          ? "Outside the requested task scope"
          : "Browser capture failed (403)";
      expect(
        await t.backend.mutation(internal.tasks.requestChecks.finish, {
          checkId: check._id,
          state:
            outcome === "rejected"
              ? {
                  kind: "completed",
                  finishedAt: Date.now(),
                  call: { startedAt: Date.now(), request: "{}", response: "{}", usage: null },
                  result: { kind: "resume", decision: { kind: "rejected", reason: message } },
                }
              : { kind: "failed", finishedAt: Date.now(), error: message, call: null },
        }),
      ).toBe(false);
      expect(await t.backend.action(api.tasks.handoff.load, t.args)).toMatchObject({
        status: "waiting",
        expiresAt: t.access.expiresAt,
        interactiveLiveViewUrl: t.browser.interactiveLiveViewUrl,
        checkMessage: message,
      });
      expect(await t.backend.action(api.tasks.handoff.resume, t.args)).toMatchObject({
        status: "checking",
        expiresAt: t.access.expiresAt,
      });
      const checks = await t.checks();
      expect(checks).toHaveLength(2);
      expect(checks[1]).toMatchObject({
        state: { kind: "pending" },
        handoff: { ...handoff, expiresAt: t.access.expiresAt },
      });
    },
  );

  it.each(["approved", "rejected"] as const)(
    "keeps a last-moment Resume checking across its deadline until %s",
    async (decision) => {
      const t = await setup(engine);
      const startedAt = t.access.expiresAt - 1;
      vi.setSystemTime(startedAt);
      expect(await t.backend.action(api.tasks.handoff.resume, t.args)).toMatchObject({
        status: "checking",
        expiresAt: t.access.expiresAt,
      });
      const [check] = await t.checks();
      if (!check) throw new Error("Expected Resume check");
      const evidence = { capturedAt: startedAt, pages: [] };
      expect(
        await t.backend.mutation(internal.tasks.requestChecks.start, {
          checkId: check._id,
          startedAt,
          request: "{}",
          evidence,
        }),
      ).toBe(true);
      for (const now of [t.access.expiresAt, t.access.expiresAt + 1]) {
        vi.setSystemTime(now);
        expect(
          await t.backend.mutation(internal.tasks.sessions.expireHandoff, {
            sessionId: t.sessionId,
            callId: handoff.callId,
            turnId: handoff.turnId,
            expiresAt: t.access.expiresAt,
          }),
        ).toBe(false);
        for (const action of [api.tasks.handoff.load, api.tasks.handoff.resume]) {
          expect(await t.backend.action(action, t.args)).toEqual({
            status: "checking",
            scoutName: "Scout",
            expiresAt: t.access.expiresAt,
            serverNow: now,
          });
        }
        expect((await t.read())?.state).toEqual({ kind: "checking", checkId: check._id });
      }
      expect(
        await t.backend.mutation(internal.tasks.requestChecks.finish, {
          checkId: check._id,
          state: {
            kind: "completed",
            finishedAt: Date.now(),
            call: { startedAt, request: "{}", response: "{}", usage: null },
            result: {
              kind: "resume",
              decision:
                decision === "approved"
                  ? { kind: "approved" }
                  : { kind: "rejected", reason: "Verification is still incomplete" },
            },
          },
        }),
      ).toBe(decision === "approved");
      if (decision === "approved") {
        expect(
          await t.backend.mutation(internal.tasks.requestChecks.releaseHandoff, {
            sessionId: t.sessionId,
            checkId: check._id,
          }),
        ).toEqual({ handoff: { ...handoff, expiresAt: t.access.expiresAt }, evidence });
        for (const action of [api.tasks.handoff.load, api.tasks.handoff.resume]) {
          expect(await t.backend.action(action, t.args)).toMatchObject({ status: "checking" });
        }
        const claimed = await t.backend.mutation(internal.tasks.sessions.claimCall, {
          sessionId: t.sessionId,
          callId: handoff.callId,
        });
        await t.backend.mutation(internal.tasks.sessions.finishCall, {
          callId: claimed.call._id,
          result: { kind: "success", output: "Browser control returned" },
        });
      } else {
        expect((await t.read())?.state).toEqual({
          kind: "waiting",
          ...handoff,
          expiresAt: t.access.expiresAt,
        });
      }
      for (const action of [api.tasks.handoff.load, api.tasks.handoff.resume]) {
        expect(await t.backend.action(action, t.args)).toEqual(
          decision === "approved"
            ? { status: "continued", scoutName: "Scout" }
            : { status: "expired" },
        );
      }
      expect((await t.read())?.state).toEqual(
        decision === "approved"
          ? { kind: "running" }
          : { kind: "stopped", reason: "handoff_expired" },
      );
      expect(await t.checks()).toHaveLength(1);
    },
  );

  it.each(["send", "retryMessage"] as const)(
    "invalidates the old token after Stop then %s, including a later run failure",
    async (operation) => {
      const t = await setup(engine);
      await t.backend.action(api.tasks.handoff.resume, t.args);
      const previous = await t.read();
      if (!previous?.workflowId) throw new Error("Expected a handoff workflow");
      const workflowId = previous.workflowId;
      await t.owner.mutation(api.tasks.sessions.stop, { sessionId: t.sessionId });
      // Seed completed cleanup and an undelivered message without running provider workflows.
      await t.backend.run(async (ctx) => {
        await ctx.db.patch(t.otherSessionId, { active: false });
        await ctx.db.patch(t.sessionId, {
          active: false,
          browser: null,
          providerId: "provider-session",
          pendingMessage: { message: "Private follow-up", workflowId, status: "queued" },
        });
      });
      expect(await t.backend.action(api.tasks.handoff.load, t.args)).toEqual({ status: "stopped" });
      if (operation === "send") {
        await t.owner.mutation(api.tasks.sessions.send, {
          sessionId: t.sessionId,
          message: "New private request",
        });
      } else {
        await t.owner.mutation(api.tasks.sessions.retryMessage, { sessionId: t.sessionId });
      }
      expect((await t.read())?.state.kind).toBe("running");
      expect((await t.read())?.handoffAccess).toBeUndefined();
      for (const action of [api.tasks.handoff.load, api.tasks.handoff.resume]) {
        expect(await t.backend.action(action, t.args)).toEqual({ status: "invalid" });
      }
      const failure = {
        kind: "failed",
        error: "New private request failed (403), request req-private",
      } as const;
      await t.backend.mutation(internal.tasks.sessions.update, {
        sessionId: t.sessionId,
        state: failure,
      });
      expect((await t.read())?.state).toEqual(failure);
      for (const action of [api.tasks.handoff.load, api.tasks.handoff.resume]) {
        expect(await t.backend.action(action, t.args)).toEqual({ status: "invalid" });
      }
      expect(await t.checks()).toHaveLength(1);
    },
  );

  it.each(["deleted", "revoked"] as const)("fails closed when the owner is %s", async (change) => {
    const t = await setup(engine);
    await t.backend.run(async (ctx) => {
      if (change === "deleted") {
        await ctx.db.replace(t.userId, { state: "deleted", deletedAt: Date.now() });
      } else {
        await ctx.db.patch(t.userId, { isApproved: false });
      }
    });
    await expect(t.backend.action(api.tasks.handoff.load, t.args)).rejects.toThrow(
      "Not authorized",
    );
    await expect(t.backend.action(api.tasks.handoff.resume, t.args)).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      t.backend.mutation(internal.tasks.handoffRecords.issue, {
        sessionId: t.sessionId,
        access: t.access,
      }),
    ).rejects.toThrow("Not authorized");
    expect((await t.read())?.state.kind).toBe("waiting");
    expect(await t.checks()).toEqual([]);
  });

  it("emails a working /handoff fragment token and stores only its private digest", async () => {
    const t = await setup(engine);
    vi.stubEnv("AGENTMAIL_API_KEY", "test-key");
    vi.stubEnv("SITE_URL", "https://example.test");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ message_id: "mail", thread_id: "mail-thread" }));
    vi.stubGlobal("fetch", request);
    await t.backend.action(internal.tasks.handoff.notify, {
      sessionId: t.sessionId,
      callId: handoff.callId,
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "https://api.agentmail.to/v0/inboxes/inbox/messages/send",
      expect.objectContaining({ method: "POST" }),
    );
    const mail = z
      .object({ to: z.array(z.string()), text: z.string() })
      .parse(JSON.parse(z.string().parse(request.mock.calls[0]?.[1]?.body)));
    expect(mail.to).toEqual(["owner@example.test"]);
    expect(mail.text).not.toContain("/tasks/");
    const url = new URL(
      z.string().parse(mail.text.split("\n").find((line) => line.startsWith("https://"))),
    );
    expect(url.origin).toBe("https://example.test");
    expect(url.pathname).toBe(`/handoff/${t.sessionId}`);
    expect(url.search).toBe("");
    const emailedToken = z.string().parse(new URLSearchParams(url.hash.slice(1)).get("access"));
    expect(emailedToken).toMatch(/^hh1_[A-Za-z0-9_-]{43}$/);
    const digest = createHash("sha256").update(emailedToken).digest("hex");
    const session = await t.read();
    expect(session?.handoffAccess).toEqual({ ...t.access, tokenHash: digest });
    expect(JSON.stringify(session)).not.toContain(emailedToken);
    const page = await t.backend.action(api.tasks.handoff.load, {
      ...t.args,
      accessToken: emailedToken,
    });
    expect(page).toMatchObject({
      status: "waiting",
      interactiveLiveViewUrl: t.browser.interactiveLiveViewUrl,
    });
    const controls = await t.owner.query(api.tasks.sessions.controls, { sessionId: t.sessionId });
    for (const result of [page, controls]) {
      expect(result).not.toHaveProperty("handoffAccess");
      expect(JSON.stringify(result)).not.toContain(digest);
      expect(JSON.stringify(result)).not.toContain(emailedToken);
    }
  });
});
