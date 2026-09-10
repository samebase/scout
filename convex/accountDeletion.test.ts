/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import { scoutAgent } from "./scout/agent";
import { finishStoppingTurn } from "./scout/turns";
import { authEmailRateLimitKey } from "./authEmail";
import { ACCOUNT_DELETION_CONFIRMATION } from "../shared/accountDeletion";
import { EMAIL_VERIFICATION_PROVIDER_ID, PASSWORD_RESET_PROVIDER_ID } from "../shared/auth";
import { ADMIN_EMAIL } from "./testing/accounts";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup(email = "deletion@example.test", isApproved = false) {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const ids = await backend.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email,
      name: "Delete this profile",
      state: "active",
      emailVerificationTime: Date.now(),
      isApproved,
    });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 86_400_000,
    });
    const otherSessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 86_400_000,
    });
    const accountId = await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: email,
      secret: "hashed-password",
      emailVerified: email,
    });
    const otherUserId = await ctx.db.insert("users", {
      email: "untouched@example.test",
      isApproved: true,
      emailVerificationTime: Date.now(),
    });
    const otherAccountId = await ctx.db.insert("authAccounts", {
      userId: otherUserId,
      provider: "password",
      providerAccountId: "untouched@example.test",
      secret: "other-hash",
    });
    const otherUserSessionId = await ctx.db.insert("authSessions", {
      userId: otherUserId,
      expirationTime: Date.now() + 86_400_000,
    });
    for (const ownerSessionId of [sessionId, otherSessionId]) {
      for (let index = 0; index < 70; index++) {
        await ctx.db.insert("authRefreshTokens", {
          sessionId: ownerSessionId,
          expirationTime: Date.now() + 86_400_000,
        });
        await ctx.db.insert("authVerifiers", {
          sessionId: ownerSessionId,
          signature: `${ownerSessionId}-${index}`,
        });
      }
    }
    for (let index = 0; index < 70; index++)
      await ctx.db.insert("authVerificationCodes", {
        accountId,
        provider: "password",
        code: `code-${index}`,
        expirationTime: Date.now() + 60_000,
      });
    for (const identifier of [email, accountId])
      await ctx.db.insert("authRateLimits", {
        identifier,
        lastAttemptTime: Date.now(),
        attemptsLeft: 2,
      });
    for (const provider of [EMAIL_VERIFICATION_PROVIDER_ID, PASSWORD_RESET_PROVIDER_ID])
      await ctx.db.insert("authEmailRateLimits", {
        key: await authEmailRateLimitKey(provider, email),
        lastSentAt: Date.now(),
      });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Shared Scout",
      websiteIdentity: { firstName: "Shared", lastName: "Scout" },
      slug: "shared",
      status: "active",
      agentMail: { inboxId: "shared-inbox", address: "shared@example.test" },
      firecrawl: { profileName: "shared-profile" },
    });
    const { threadId } = await scoutAgent.createThread(ctx, { userId });
    const chatId = await ctx.db.insert("scoutChats", {
      purpose: { kind: "general" },
      visibility: "private",
      threadId,
      userId,
      scoutId,
      createdAt: Date.now(),
    });
    const { messageId, message } = await scoutAgent.saveMessage(ctx, {
      threadId,
      userId,
      prompt: "Keep this shared history",
      skipEmbeddings: true,
    });
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
      sessionId,
      otherSessionId,
      accountId,
      otherUserId,
      otherAccountId,
      otherUserSessionId,
      scoutId,
      chatId,
      threadId,
      messageId,
      turnId,
      fileId,
      callId,
    };
  });
  const viewer = backend.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` });
  return { backend, viewer, ...ids };
}

test.each([
  ["pending@example.test", false],
  ["approved@example.test", true],
  [ADMIN_EMAIL, false],
])("%s can delete itself while shared chat and file history stays", async (email, isApproved) => {
  const {
    backend,
    viewer,
    userId,
    otherAccountId,
    otherUserSessionId,
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
  await expect(viewer.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
  await expect(
    viewer.mutation(api.accounts.setApproval, { userId, isApproved: true }),
  ).rejects.toThrow("Not authorized");
  await expect(backend.query(internal.accounts.assertActiveForAuth, { userId })).rejects.toThrow(
    "deleted",
  );
  await expect(
    backend.mutation(internal.authEmailRateLimit.consume, {
      email,
      providerId: PASSWORD_RESET_PROVIDER_ID,
    }),
  ).rejects.toThrow("Account unavailable");
  const requested = await backend.run((ctx) => ctx.db.get(userId));
  await viewer.mutation(api.accountDeletion.request, {
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
  });
  expect(await backend.run((ctx) => ctx.db.get(userId))).toEqual(requested);
  await backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await viewer.query(api.accountDeletion.status, {})).toEqual({ kind: "deleted" });
  await expect(
    backend.mutation(internal.authEmailRateLimit.consume, {
      email,
      providerId: PASSWORD_RESET_PROVIDER_ID,
    }),
  ).rejects.toThrow("Account unavailable");
  await expect(viewer.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
  await backend.run(async (ctx) => {
    const user = await ctx.db.get(userId);
    expect(user).toEqual({
      _id: userId,
      _creationTime: expect.any(Number),
      state: "deleted",
      deletedAt: expect.any(Number),
    });
    expect(await ctx.db.query("authAccounts").collect()).toEqual([
      await ctx.db.get(otherAccountId),
    ]);
    expect(await ctx.db.query("authSessions").collect()).toEqual([
      await ctx.db.get(otherUserSessionId),
    ]);
    expect(await ctx.db.query("authRefreshTokens").collect()).toEqual([]);
    expect(await ctx.db.query("authVerifiers").collect()).toEqual([]);
    expect(await ctx.db.query("authVerificationCodes").collect()).toEqual([]);
    expect(await ctx.db.query("authRateLimits").collect()).toEqual([]);
    expect(await ctx.db.query("authEmailRateLimits").collect()).toEqual([]);
    expect(await ctx.db.get(scoutId)).toEqual(before.scout);
    expect(await ctx.db.get(chatId)).toEqual(before.chat);
    expect(await ctx.db.get(turnId)).toEqual(before.turn);
    expect(await ctx.db.get(callId)).toEqual(before.call);
    expect(await ctx.db.get(otherUserId)).toEqual(before.otherUser);
    expect(await (await ctx.storage.get(fileId))?.text()).toBe("Keep this file");
    const thread = await scoutAgent.getThreadMetadata(ctx, { threadId });
    expect(thread.userId).toBe(userId);
    const messages = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [messageId],
    });
    expect(messages[0]?.text).toBe("Keep this shared history");
  });
});

test("deletion requires the exact confirmation and a valid own session", async () => {
  const { backend, viewer, userId, otherUserSessionId } = await setup();
  await expect(
    backend.mutation(api.accountDeletion.request, { confirmation: ACCOUNT_DELETION_CONFIRMATION }),
  ).rejects.toThrow("Not authorized");
  await expect(
    viewer.mutation(api.accountDeletion.request, { confirmation: "delete" }),
  ).rejects.toThrow("Type delete my account");
  const mismatched = backend.withIdentity({ subject: `${userId}|${otherUserSessionId}` });
  await expect(
    mismatched.mutation(api.accountDeletion.request, {
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
    }),
  ).rejects.toThrow("Sign in again");
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
