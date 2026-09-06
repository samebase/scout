import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  workflowTest.register(backend);
  const userId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
  const otherId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
  const scoutId = await backend.run((ctx) =>
    ctx.db.insert("scouts", {
      displayName: "Click Scout",
      websiteIdentity: { firstName: "Click", lastName: "Scout" },
      slug: "click-scout",
      status: "active",
      agentMail: { inboxId: "click-inbox", address: "click@example.test" },
      firecrawl: { profileName: "click-profile" },
    }),
  );
  const owner = backend.withIdentity({ subject: `${userId}|test-session` });
  const other = backend.withIdentity({ subject: `${otherId}|test-session` });
  const { threadId } = await owner.mutation(api.scout.chats.createThread, { scoutId });
  const { sessionId } = await owner.mutation(internal.scout.browserSessions.open, {
    threadId,
    scoutId,
    source: { kind: "manual" },
    providerSessionId: "click-provider",
    cdpUrl: "wss://browser.firecrawl.dev/cdp?token=secret",
    interactiveLiveViewUrl: null,
    providerExpiresAtMs: Date.now() + 60_000,
    profileName: "click-profile",
  });
  await owner.mutation(internal.scout.browserSessions.prepareOperation, {
    sessionId,
    toolCallId: "click-1",
    action: { kind: "execute", code: "await page.mouse.click(320, 400)" },
  });
  return { backend, owner, other, sessionId };
}

describe("browser click persistence and access", () => {
  test("retains clicks on failed actions, settles once, and returns them only to the owner", async () => {
    const { backend, owner, other, sessionId } = await setup();
    const clickCapture = {
      kind: "captured",
      startedAtMs: 1_000,
      endedAtMs: 2_000,
      incomplete: false,
      truncated: false,
      clicks: [{ tabId: "tab-a", atMs: 1_500, x: 0.25, y: 0.5 }],
    } as const;
    const capture = { ...clickCapture, clicks: [...clickCapture.clicks] };
    await owner.mutation(internal.scout.browserSessions.settleOperation, {
      sessionId,
      toolCallId: "click-1",
      outcome: { kind: "indeterminate_after_dispatch", failure: "Navigation timed out" },
      clickCapture: capture,
    });
    await owner.mutation(internal.scout.browserSessions.settleOperation, {
      sessionId,
      toolCallId: "click-1",
      outcome: { kind: "failed_before_dispatch", failure: "duplicate" },
      clickCapture: { kind: "unavailable" },
    });
    const replay = await owner.query(internal.scout.browserSessions.replayData, { sessionId });
    expect(replay?.operations).toEqual([
      {
        sequence: 1,
        state: expect.objectContaining({ kind: "indeterminate_after_dispatch" }),
        clickCapture: capture,
      },
    ]);
    expect(JSON.stringify(replay?.operations)).not.toContain("page.mouse");
    await expect(
      other.query(internal.scout.browserSessions.replayData, { sessionId }),
    ).resolves.toBeNull();
    await expect(
      backend.query(internal.scout.browserSessions.replayData, { sessionId }),
    ).rejects.toThrow("Not authorized");
  });

  test("rejects unbounded or invalid coordinates without settling the operation", async () => {
    const { owner, sessionId } = await setup();
    for (const clicks of [
      [{ tabId: "a", atMs: 1_500, x: 1.1, y: 0.5 }],
      Array.from({ length: 65 }, () => ({ tabId: "a", atMs: 1_500, x: 0.5, y: 0.5 })),
    ]) {
      await expect(
        owner.mutation(internal.scout.browserSessions.settleOperation, {
          sessionId,
          toolCallId: "click-1",
          outcome: { kind: "failed_before_dispatch", failure: "test" },
          clickCapture: {
            kind: "captured",
            startedAtMs: 1_000,
            endedAtMs: 2_000,
            incomplete: false,
            truncated: false,
            clicks,
          },
        }),
      ).rejects.toThrow("Invalid browser click capture");
    }
    const replay = await owner.query(internal.scout.browserSessions.replayData, { sessionId });
    expect(replay?.operations[0]).toMatchObject({
      state: { kind: "prepared" },
      clickCapture: null,
    });
  });
});
