import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import { api } from "./_generated/api";
import schema from "./schema";
import { CURRENT_TERMS_VERSION, TERMS_ACCEPTANCE_REQUIRED } from "../shared/terms";
import { ADMIN_EMAIL } from "./testing/accounts";

const modules = import.meta.glob("./**/*.ts");

test.each([ADMIN_EMAIL, "member@example.test"])(
  "%s must accept before protected queries, mutations, and actions work",
  async (email) => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email,
        emailVerificationTime: Date.now(),
        isApproved: true,
      }),
    );
    const user = t.withIdentity({ subject: `${userId}|session` });
    expect(await user.query(api.accounts.currentViewerAccess, {})).toEqual({
      kind: "terms_required",
      userId,
    });
    await expect(user.query(api.accounts.taskPreferences, {})).rejects.toThrow(
      TERMS_ACCEPTANCE_REQUIRED,
    );
    await expect(user.mutation(api.accounts.setTaskPreferences, {})).rejects.toThrow(
      TERMS_ACCEPTANCE_REQUIRED,
    );
    await expect(user.action(api.polar.checkout, {})).rejects.toThrow(TERMS_ACCEPTANCE_REQUIRED);
    expect(await user.query(api.accountDeletion.status, {})).toEqual({ kind: "ready" });
    await expect(user.mutation(api.terms.accept, { version: "old-terms" })).rejects.toThrow(
      "The terms have changed",
    );
    expect(await t.run((ctx) => ctx.db.query("termsAcceptances").collect())).toEqual([]);

    const before = Date.now();
    await user.mutation(api.terms.accept, { version: CURRENT_TERMS_VERSION });
    const rows = await t.run((ctx) => ctx.db.query("termsAcceptances").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      version: CURRENT_TERMS_VERSION,
      acceptedAt: expect.any(Number),
    });
    expect(rows[0]?.acceptedAt).toBeGreaterThanOrEqual(before);
    expect(rows[0]?.acceptedAt).toBeLessThanOrEqual(Date.now());
    expect(await user.query(api.accounts.currentViewerAccess, {})).toMatchObject({
      kind: "account",
    });
    await expect(user.query(api.accounts.taskPreferences, {})).resolves.toEqual({});
    await user.mutation(api.terms.accept, { version: CURRENT_TERMS_VERSION });
    expect(await t.run((ctx) => ctx.db.query("termsAcceptances").collect())).toEqual(rows);
  },
);

test("renewed agreement keeps older acceptance records and does not approve an account", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      email: "member@example.test",
      emailVerificationTime: 1,
      acceptedTermsVersion: "old-terms",
    });
    await ctx.db.insert("termsAcceptances", { userId: id, version: "old-terms", acceptedAt: 1 });
    return id;
  });
  const user = t.withIdentity({ subject: `${userId}|session` });
  expect(await user.query(api.accounts.currentViewerAccess, {})).toMatchObject({
    kind: "terms_required",
  });
  await user.mutation(api.terms.accept, { version: CURRENT_TERMS_VERSION });
  expect(await user.query(api.accounts.currentViewerAccess, {})).toMatchObject({
    kind: "account",
    role: "role_pending_access",
    isApproved: false,
  });
  const records = await t.run((ctx) => ctx.db.query("termsAcceptances").collect());
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({ version: "old-terms", acceptedAt: 1 });
});

test("anonymous and unverified users cannot record acceptance through the account endpoint", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.terms.accept, { version: CURRENT_TERMS_VERSION })).rejects.toThrow(
    "Not authorized",
  );
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "member@example.test" }));
  const user = t.withIdentity({ subject: `${userId}|session` });
  await expect(user.mutation(api.terms.accept, { version: CURRENT_TERMS_VERSION })).rejects.toThrow(
    "Not authorized",
  );
  await t.run((ctx) => ctx.db.replace(userId, { state: "deleted", deletedAt: Date.now() }));
  await expect(user.mutation(api.terms.accept, { version: CURRENT_TERMS_VERSION })).rejects.toThrow(
    "Not authorized",
  );
});
