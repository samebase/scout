/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { registerCore } from "@convex-dev/auth/test";
import { registerEmail } from "@convex-dev/auth/components/email/test";
import { registerPasswordProvider } from "@convex-dev/auth/components/password/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { Firecrawl } from "firecrawl";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import { finishStoppingTurn } from "./scout/turns";
import { createEmailPasswordAccount, setNewPassword } from "./auth";
import { ACCOUNT_DELETION_CONFIRMATION } from "../shared/accountDeletion";
import { ADMIN_EMAIL } from "./testing/accounts";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function setup(email = "deletion@example.test", isApproved = false) {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  registerCore(backend);
  registerPasswordProvider(backend);
  registerEmail(backend);
  await backend.run((ctx) =>
    ctx.db.insert("taskEngineSettings", { key: "global", agentsApiEnabled: true }),
  );
  const ids = await backend.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email,
      name: "Delete this profile",
      state: "active",
      emailVerificationTime: Date.now(),
      isApproved,
    });
    await setNewPassword(ctx, userId, "deletion-password-123");
    await createEmailPasswordAccount(ctx, userId);
    const otherUserId = await ctx.db.insert("users", {
      email: "untouched@example.test",
      isApproved: true,
      emailVerificationTime: Date.now(),
    });
    await setNewPassword(ctx, otherUserId, "untouched-password-123");
    await createEmailPasswordAccount(ctx, otherUserId);
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Shared Scout",
      websiteIdentity: { firstName: "Shared", lastName: "Scout" },
      slug: "shared",
      status: "active",
      agentMail: { inboxId: "shared-inbox", address: "shared@example.test" },
      firecrawl: { profileName: "shared-profile" },
    });
    const { _id: threadId } = await ctx.runMutation(components.agent.threads.createThread, {
      userId,
    });
    const chatId = await ctx.db.insert("scoutChats", {
      purpose: { kind: "general" },
      visibility: "private",
      threadId,
      userId,
      scoutId,
      createdAt: Date.now(),
    });
    const {
      messages: [message],
    } = await ctx.runMutation(components.agent.messages.addMessages, {
      threadId,
      userId,
      messages: [{ message: { role: "user", content: "Keep this shared history" } }],
    });
    if (!message) throw new Error("Expected a stored history message");
    const messageId = message._id;
    const turnId = await ctx.db.insert("scoutTurns", {
      threadId,
      order: message.order,
      promptMessageId: messageId,
      scoutId,
      model: "qwen/qwen3.7-flash",
      startedAt: Date.now(),
      state: { kind: "completed", completedAt: Date.now(), usage: {} },
    });
    const fileId = await ctx.storage.store(new Blob(["Keep this file"]));
    const callId = await ctx.db.insert("scoutModelCalls", {
      turnId,
      sequence: 0,
      provider: "test",
      modelId: "test",
      startedAt: Date.now(),
      messageCount: 1,
      toolCount: 0,
      compactedBrowserSnapshotCount: 0,
      serializedBytes: 14,
      snapshotStorageId: fileId,
      state: { kind: "completed", finishedAt: Date.now(), finishReason: "stop", usage: {} },
    });
    return {
      userId,
      otherUserId,
      scoutId,
      chatId,
      threadId,
      messageId,
      turnId,
      fileId,
      callId,
    };
  });
  const viewer = backend.withIdentity({ subject: ids.userId });
  return { backend, viewer, ...ids };
}

test("account deletion stops a managed Review before deleting the owner", async () => {
  const { backend, viewer, userId, scoutId } = await setup("review-deletion@example.test", true);
  await viewer.mutation(api.accounts.acceptTerms, { sessionRecordingConsent: false });
  const { threadId } = await viewer.mutation(api.scout.chats.startProductChat, {
    selection: { engine: "agents_api", model: "gpt-5.6-luna" },
    product: { kind: "review" },
    scoutId,
    prompt: "Try a product",
    visibility: "public",
  });
  await viewer.mutation(api.accountDeletion.request, {
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
  });
  const next = await backend.mutation(internal.accountDeletionCleanup.stopChat, {
    userId,
    threadId,
  });
  if (next.kind !== "close_managed") throw new Error("Expected managed cleanup");
  expect(await backend.run((ctx) => ctx.db.get(next.sessionId))).toMatchObject({
    active: true,
    state: { kind: "stopped" },
  });
  // No provider or browser has been created yet; cleanup can release the reservation directly.
  await backend.action(internal.tasks.runtime.cleanup, { sessionId: next.sessionId });
  expect(
    await backend.mutation(internal.accountDeletionCleanup.stopChat, { userId, threadId }),
  ).toEqual({ kind: "ready" });
  expect(await backend.run((ctx) => ctx.db.get(scoutId))).not.toBeNull();
});

test.each(["agents_api", "convex_agent"] as const)(
  "account deletion releases a standalone %s task without a product chat binding",
  async (engine) => {
    const { backend, viewer, userId, scoutId } = await setup(ADMIN_EMAIL);
    const sessionId = await backend.run((ctx) =>
      ctx.db.insert("agentsApiSessions", {
        userId,
        scoutId,
        scoutName: "Standalone Scout",
        title: "Standalone admin task",
        model: "test",
        engine,
        state: { kind: "running" },
        active: true,
        nextSequence: 0,
        browser: null,
        usage: null,
      }),
    );
    await viewer.mutation(api.accountDeletion.request, {
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
    });
    await backend.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await viewer.query(api.accountDeletion.status, {})).toEqual({ kind: "deleted" });
    expect(await backend.run((ctx) => ctx.db.get(sessionId))).toMatchObject({
      engine,
      active: false,
      state: { kind: "stopped" },
    });
  },
);

test("account deletion closes a stored legacy browser and retains its replay records", async () => {
  const { backend, viewer, userId, scoutId, threadId, turnId, chatId } = await setup(ADMIN_EMAIL);
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  const closeBrowser = vi.spyOn(Firecrawl.prototype, "deleteBrowser").mockResolvedValue({
    success: true,
    sessionDurationMs: 12_000,
    creditsBilled: 2,
  });
  const browserId = await backend.run((ctx) =>
    ctx.db.insert("scoutBrowserSessions", {
      threadId,
      scoutId,
      sequence: 1,
      provider: "firecrawl",
      providerSessionId: "stored-legacy-browser",
      profileName: "legacy-profile",
      viewport: { width: 1280, height: 800 },
      nextOperationSequence: 1,
      lifecycle: {
        kind: "active",
        openedAtMs: Date.now(),
        providerExpiresAtMs: Date.now() + 60_000,
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=test",
        interactiveLiveViewUrl: null,
      },
    }),
  );
  await viewer.mutation(api.accountDeletion.request, {
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
  });
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(closeBrowser).toHaveBeenCalledExactlyOnceWith("stored-legacy-browser");
  expect(await viewer.query(api.accountDeletion.status, {})).toEqual({ kind: "deleted" });
  expect(await backend.run((ctx) => ctx.db.get(browserId))).toMatchObject({
    providerSessionId: "stored-legacy-browser",
    lifecycle: { kind: "closed", creditsBilled: 2 },
  });
  expect(await backend.run((ctx) => ctx.db.get(turnId))).toMatchObject({
    state: { kind: "stopped", firecrawlCredits: 2 },
  });
  expect(await backend.run((ctx) => ctx.db.get(chatId))).toMatchObject({ userId, threadId });
});

test.each([
  ["pending@example.test", false],
  ["approved@example.test", true],
  [ADMIN_EMAIL, false],
])("%s can delete itself while shared chat and file history stays", async (email, isApproved) => {
  const {
    backend,
    viewer,
    userId,
    otherUserId,
    scoutId,
    chatId,
    threadId,
    messageId,
    turnId,
    fileId,
    callId,
  } = await setup(email, isApproved);
  const before = await backend.run(async (ctx) => ({
    scout: await ctx.db.get(scoutId),
    chat: await ctx.db.get(chatId),
    turn: await ctx.db.get(turnId),
    call: await ctx.db.get(callId),
    otherUser: await ctx.db.get(otherUserId),
  }));
  await viewer.mutation(api.accountDeletion.request, {
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
  });
  expect(await viewer.query(api.accounts.currentViewerAccess, {})).toEqual({ kind: "deleting" });
  await expect(viewer.query(api.accounts.taskPreferences, {})).rejects.toThrow("Not authorized");
  await expect(
    viewer.mutation(api.accounts.setApproval, { userId, isApproved: true }),
  ).rejects.toThrow("Not authorized");
  const signIn = {
    provider: { name: "emailPassword" as const, accountId: userId, profile: {} },
    userId,
  };
  await expect(backend.mutation(internal.auth.onSignIn, signIn)).rejects.toThrow("deleted");
  const requested = await backend.run((ctx) => ctx.db.get(userId));
  await viewer.mutation(api.accountDeletion.request, {
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
  });
  expect(await backend.run((ctx) => ctx.db.get(userId))).toEqual(requested);
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await viewer.query(api.accountDeletion.status, {})).toEqual({ kind: "deleted" });
  await expect(backend.mutation(internal.auth.onSignIn, signIn)).rejects.toThrow("deleted");
  await expect(viewer.query(api.accounts.taskPreferences, {})).rejects.toThrow("Not authorized");
  await backend.run(async (ctx) => {
    const user = await ctx.db.get(userId);
    expect(user).toEqual({
      _id: userId,
      _creationTime: expect.any(Number),
      state: "deleted",
      deletedAt: expect.any(Number),
    });
    // Convex Auth keeps nothing for the deleted user, and the other account keeps its sign-in.
    for (const [owner, expected] of [
      [userId, null],
      [otherUserId, otherUserId],
    ] as const)
      expect(
        await ctx.runQuery(components.auth.public.getUserIdByAccount, {
          provider: "emailPassword",
          providerAccountId: owner,
        }),
      ).toBe(expected);
    await expect(
      ctx.runMutation(components.authPassword.public.verifyPassword, {
        userId,
        password: "deletion-password-123",
      }),
    ).rejects.toThrow("No password stored");
    expect(
      await ctx.runMutation(components.authPassword.public.verifyPassword, {
        userId: otherUserId,
        password: "untouched-password-123",
      }),
    ).toEqual({ success: true });
    expect(await ctx.db.get(scoutId)).toEqual(before.scout);
    expect(await ctx.db.get(chatId)).toEqual(before.chat);
    expect(await ctx.db.get(turnId)).toEqual(before.turn);
    expect(await ctx.db.get(callId)).toEqual(before.call);
    expect(await ctx.db.get(otherUserId)).toEqual(before.otherUser);
    expect(await (await ctx.storage.get(fileId))?.text()).toBe("Keep this file");
    const thread = await ctx.runQuery(components.agent.threads.getThread, { threadId });
    expect(thread?.userId).toBe(userId);
    const messages = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [messageId],
    });
    expect(messages[0]?.text).toBe("Keep this shared history");
  });
});

test("deletion requires a signed-in account and the exact confirmation", async () => {
  const { backend, viewer } = await setup();
  await expect(
    backend.mutation(api.accountDeletion.request, { confirmation: ACCOUNT_DELETION_CONFIRMATION }),
  ).rejects.toThrow("Not authorized");
  await expect(
    viewer.mutation(api.accountDeletion.request, { confirmation: "delete" }),
  ).rejects.toThrow("Type delete my account");
  await expect(backend.mutation(api.accountDeletion.retry, {})).rejects.toThrow("Not authorized");
  expect(await viewer.query(api.accountDeletion.status, {})).toEqual({ kind: "ready" });
});

test("a failed cleanup stays deleting and can resume without deleting chat history", async () => {
  const { backend, viewer, userId, turnId, chatId } = await setup();
  await backend.run((ctx) =>
    ctx.db.patch(turnId, {
      state: {
        kind: "stopping",
        stopRequestedAt: Date.now() - 13 * 60_000,
        generationFinished: false,
        usage: {},
      },
    }),
  );
  await viewer.mutation(api.accountDeletion.request, {
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
  });
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await viewer.query(api.accountDeletion.status, {})).toEqual({ kind: "failed" });
  expect(await backend.run((ctx) => ctx.db.get(userId))).toMatchObject({ state: "deleting" });
  await backend.run((ctx) =>
    ctx.db.patch(turnId, { state: { kind: "stopped", stoppedAt: Date.now(), usage: {} } }),
  );
  await viewer.mutation(api.accountDeletion.retry, {});
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await viewer.query(api.accountDeletion.status, {})).toEqual({ kind: "deleted" });
  expect(await backend.run((ctx) => ctx.db.get(chatId))).not.toBeNull();
});

test("active Lab work stops before account deletion finishes", async () => {
  const { backend, viewer, userId, threadId, turnId } = await setup(ADMIN_EMAIL);
  await backend.run((ctx) =>
    ctx.db.patch(turnId, {
      state: { kind: "pending", leaseExpiresAt: Date.now() + 60_000, completedSteps: 0, usage: {} },
    }),
  );
  await viewer.mutation(api.accountDeletion.request, {
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
  });
  expect(
    await backend.mutation(internal.accountDeletionCleanup.stopChat, { userId, threadId }),
  ).toEqual({ kind: "waiting" });
  expect(await backend.run((ctx) => ctx.db.get(turnId))).toMatchObject({
    state: { kind: "stopping" },
  });
  await backend.run((ctx) => finishStoppingTurn(ctx, turnId));
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await viewer.query(api.accountDeletion.status, {})).toEqual({ kind: "deleted" });
  expect(await backend.run((ctx) => ctx.db.get(turnId))).toMatchObject({
    state: { kind: "stopped" },
  });
});

test("finishing a stored replacement stops the retired turn without creating new execution", async () => {
  const { backend, turnId, threadId } = await setup(ADMIN_EMAIL);
  await backend.run((ctx) =>
    ctx.db.patch(turnId, {
      state: {
        kind: "stopping",
        stopRequestedAt: Date.now(),
        generationFinished: true,
        replacement: { prompt: "Do not restart this legacy turn", model: "qwen/qwen3.7-flash" },
        usage: { promptTokens: 12 },
      },
    }),
  );
  await backend.mutation(internal.scout.turns.finalizeStopping, { turnId });
  expect(await backend.run((ctx) => ctx.db.get(turnId))).toMatchObject({
    state: { kind: "stopped", usage: { promptTokens: 12 } },
  });
  expect(
    await backend.run((ctx) =>
      ctx.db
        .query("scoutTurns")
        .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", threadId))
        .take(2),
    ),
  ).toHaveLength(1);
  expect(await backend.run((ctx) => ctx.db.query("agentsApiSessions").first())).toBeNull();
});

test("a persisted handoff expiry still closes its legacy browser without resuming Scout", async () => {
  const { backend, viewer, userId, scoutId, threadId, turnId } = await setup(ADMIN_EMAIL);
  await viewer.mutation(api.accountDeletion.request, {
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
  });
  const { browserId, handoffId } = await backend.run(async (ctx) => {
    const user = await ctx.db.get(userId);
    if (user?.state !== "deleting") throw new Error("Expected a cleanup workflow");
    const browserId = await ctx.db.insert("scoutBrowserSessions", {
      threadId,
      scoutId,
      sequence: 1,
      provider: "firecrawl",
      providerSessionId: "expiring-legacy-browser",
      profileName: "legacy-profile",
      viewport: { width: 1280, height: 800 },
      nextOperationSequence: 1,
      lifecycle: {
        kind: "active",
        openedAtMs: Date.now() - 60_000,
        providerExpiresAtMs: Date.now() + 60_000,
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=test",
        interactiveLiveViewUrl: null,
      },
    });
    const handoffId = await ctx.db.insert("scoutHumanHandoffs", {
      sessionId: browserId,
      turnId,
      reason: "Old verification step",
      requestedAt: Date.now() - 60_000,
      claimExpiresAt: Date.now() - 1,
      accessTokenHash: "a".repeat(64),
      workflowId: user.workflowId,
      status: "available",
    });
    return { browserId, handoffId };
  });
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  const closeBrowser = vi
    .spyOn(Firecrawl.prototype, "deleteBrowser")
    .mockResolvedValue({ success: true });
  expect(await backend.mutation(internal.humanHandoffs.expire, { handoffId })).toBe("expired");
  expect(await backend.mutation(internal.humanHandoffs.expire, { handoffId })).toBe("expired");
  await backend.action(internal.humanHandoffBrowser.finishBrowserSession, {
    sessionId: browserId,
    usageTurnId: turnId,
    captureEvidence: false,
  });
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(closeBrowser).toHaveBeenCalledExactlyOnceWith("expiring-legacy-browser");
  expect(await backend.run((ctx) => ctx.db.get(browserId))).toMatchObject({
    lifecycle: { kind: "closed" },
  });
  expect(await backend.run((ctx) => ctx.db.get(handoffId))).toMatchObject({ status: "expired" });
  expect(
    await backend.run((ctx) =>
      ctx.db
        .query("scoutTurns")
        .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", threadId))
        .take(2),
    ),
  ).toHaveLength(1);
});
