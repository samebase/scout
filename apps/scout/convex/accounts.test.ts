import { convexTest } from "convex-test";
import { expect, test } from "vite-plus/test";
import { api } from "./_generated/api";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const backend = convexTest(schema, modules);
  const adminId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
  const memberId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "member@example.test" }),
  );
  const admin = backend.withIdentity({ subject: `${adminId}|session` });
  const member = backend.withIdentity({ subject: `${memberId}|session` });
  return { backend, adminId, memberId, admin, member };
}

test("anonymous, missing, and unverified accounts cannot use protected functions", async () => {
  const { backend, admin, adminId } = await setup();
  expect(await backend.query(api.accounts.currentViewerAccess, {})).toEqual({ kind: "anonymous" });
  await backend.run((ctx) => ctx.db.patch(adminId, { emailVerificationTime: undefined }));
  expect(await admin.query(api.accounts.currentViewerAccess, {})).toEqual({ kind: "unavailable" });
  await expect(admin.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
  await backend.run((ctx) => ctx.db.delete(adminId));
  await expect(admin.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
});

test.each(["nicu.dev@gmail.com", "nicu@samebase.com", "NICU.DEV@GMAIL.COM"])(
  "Scout staff email %s grants admin access independently of approval",
  async (email) => {
    const backend = convexTest(schema, modules);
    const userId = await backend.run((ctx) =>
      ctx.db.insert("users", { email, emailVerificationTime: Date.now() }),
    );
    const admin = backend.withIdentity({ subject: `${userId}|session` });
    expect(await admin.query(api.accounts.currentViewerAccess, {})).toMatchObject({
      email,
      role: "role_staff",
      isApproved: false,
      accessKeys: expect.arrayContaining(["access_lab", "access_members_manage"]),
    });
    await admin.mutation(api.accounts.setApproval, { userId, isApproved: false });
    await expect(admin.query(api.scout.scouts.list, {})).resolves.toEqual([]);
    const stored = await backend.run((ctx) => ctx.db.get(userId));
    expect(stored).not.toHaveProperty("role");
    expect(stored).not.toHaveProperty("status");
  },
);

test.each(["member@example.test", "nicuchiciuc@gmail.com", "NICUCHICIUC@GMAIL.COM"])(
  "%s gets member access only through users.isApproved in the same session",
  async (email) => {
    const { backend, admin } = await setup();
    const userId = await backend.run((ctx) =>
      ctx.db.insert("users", { email, emailVerificationTime: Date.now() }),
    );
    const member = backend.withIdentity({ subject: `${userId}|session` });
    const pending = {
      email,
      role: "role_pending_access",
      isApproved: false,
      accessKeys: ["access_public", "access_account"],
    };
    expect(await member.query(api.accounts.currentViewerAccess, {})).toMatchObject(pending);
    await expect(
      member.mutation(api.accounts.setApproval, { userId, isApproved: true }),
    ).rejects.toThrow("Not authorized");
    await backend.run((ctx) => ctx.db.patch(userId, { isApproved: true }));
    expect(await member.query(api.accounts.currentViewerAccess, {})).toMatchObject({
      email,
      role: "role_member",
      isApproved: true,
      accessKeys: [
        "access_public",
        "access_account",
        "access_play",
        "access_review",
        "access_scout_view",
      ],
    });
    await admin.mutation(api.accounts.setApproval, { userId, isApproved: false });
    expect(await member.query(api.accounts.currentViewerAccess, {})).toMatchObject(pending);
    await admin.mutation(api.accounts.setApproval, { userId, isApproved: true });
    await admin.mutation(api.accounts.setApproval, { userId, isApproved: true });
    await expect(member.query(api.scout.scouts.list, {})).resolves.toEqual([]);
    expect(await backend.run((ctx) => ctx.db.query("scouts").collect())).toEqual([]);
    const accounts = await admin.query(api.accounts.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(accounts.page.find((account) => account.userId === userId)).toMatchObject({
      email,
      role: "role_member",
      isApproved: true,
      verified: true,
    });
  },
);

test("member queries, mutations, and actions enforce admin permissions", async () => {
  const { admin, member, memberId } = await setup();
  await expect(admin.query(api.scout.scouts.list, {})).resolves.toEqual([]);
  await expect(member.query(api.scout.scouts.list, {})).resolves.toEqual([]);
  await expect(
    member.query(api.accounts.list, {
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("Not authorized");
  await expect(
    member.mutation(api.accounts.setApproval, { userId: memberId, isApproved: true }),
  ).rejects.toThrow("Not authorized");
  await expect(
    member.query(api.scout.chats.listThreads, { paginationOpts: { numItems: 10, cursor: null } }),
  ).rejects.toThrow("Not authorized");
  await expect(
    member.action(api.scout.manual.executeTool, {
      threadId: "known-thread",
      toolName: "web_search",
      input: "{}",
      operationId: "test-operation",
    }),
  ).rejects.toThrow("Not authorized");
});

test("approval does not bypass email verification", async () => {
  const { backend, admin, member, memberId } = await setup();
  await backend.run((ctx) => ctx.db.patch(memberId, { emailVerificationTime: undefined }));
  await admin.mutation(api.accounts.setApproval, { userId: memberId, isApproved: true });
  expect(await member.query(api.accounts.currentViewerAccess, {})).toEqual({ kind: "unavailable" });
  await expect(member.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
});
