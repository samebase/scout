import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import schema from "./schema";
import { api } from "./_generated/api";
import { insertTestAccount } from "./testing/accounts";
import { SESSION_RECORDING_CONSENT_VERSION } from "../shared/sessionRecording";

const modules = import.meta.glob("./**/*.*s");

test("recording defaults off for existing users, and only the caller's preference changes", async () => {
  const t = convexTest(schema, modules);
  const alice = await t.run((ctx) => insertTestAccount(ctx, { email: "alice@example.test" }));
  const bob = await t.run((ctx) => insertTestAccount(ctx, { email: "bob@example.test" }));
  const asAlice = t.withIdentity({ subject: `${alice}|session` });
  const asBob = t.withIdentity({ subject: `${bob}|session` });
  expect(await asAlice.query(api.accounts.analyticsPreferences, {})).toEqual({
    userId: alice,
    recording: null,
  });
  await expect(t.mutation(api.accounts.setSessionRecording, { enabled: true })).rejects.toThrow(
    "Not authorized",
  );
  await asAlice.mutation(api.accounts.setSessionRecording, { enabled: true });
  expect(await asAlice.query(api.accounts.analyticsPreferences, {})).toMatchObject({
    userId: alice,
    recording: {
      enabled: true,
      version: SESSION_RECORDING_CONSENT_VERSION,
      source: "settings",
      updatedAt: expect.any(Number),
    },
  });
  expect(await asBob.query(api.accounts.analyticsPreferences, {})).toEqual({
    userId: bob,
    recording: null,
  });
  await asAlice.mutation(api.accounts.setSessionRecording, { enabled: false });
  expect(await asAlice.query(api.accounts.analyticsPreferences, {})).toMatchObject({
    recording: { enabled: false },
  });
});

test("pending and terms-required accounts can withdraw; deleted accounts cannot grant consent", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      email: "pending@example.test",
      emailVerificationTime: Date.now(),
      isApproved: false,
    }),
  );
  const user = t.withIdentity({ subject: `${userId}|session` });
  await user.mutation(api.accounts.setSessionRecording, { enabled: false });
  expect(await user.query(api.accounts.analyticsPreferences, {})).toMatchObject({
    recording: { enabled: false },
  });
  await t.run((ctx) => ctx.db.replace(userId, { state: "deleted", deletedAt: Date.now() }));
  expect(await user.query(api.accounts.analyticsPreferences, {})).toBeNull();
  await expect(user.mutation(api.accounts.setSessionRecording, { enabled: true })).rejects.toThrow(
    "Not authorized",
  );
});
