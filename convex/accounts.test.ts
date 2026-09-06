import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup() {
  const backend = convexTest(schema, modules);
  const adminId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: "admin@example.test", role: "role_admin" }),
  );
  const memberId = await backend.run((ctx) =>
    insertTestAccount(ctx, { email: ADMIN_EMAIL, role: "role_member" }),
  );
  const admin = backend.withIdentity({ subject: `${adminId}|session` });
  const member = backend.withIdentity({ subject: `${memberId}|session` });
  return { backend, adminId, memberId, admin, member };
}

test("unavailable identities fail closed and initialization always starts as a member", async () => {
  const backend = convexTest(schema, modules);
  expect(await backend.query(api.accounts.currentViewerAccess, {})).toEqual({ kind: "anonymous" });
  const userId = await backend.run((ctx) => ctx.db.insert("users", { email: ADMIN_EMAIL }));
  const user = backend.withIdentity({ subject: `${userId}|session` });
  expect(await user.query(api.accounts.currentViewerAccess, {})).toEqual({ kind: "unavailable" });
  await backend.mutation(internal.accounts.initialize, { userId });
  expect(await user.query(api.accounts.currentViewerAccess, {})).toEqual({ kind: "unavailable" });
  await expect(backend.mutation(internal.accounts.bootstrapAdmin, { userId })).rejects.toThrow(
    "verified",
  );
  await backend.run((ctx) => ctx.db.patch(userId, { emailVerificationTime: Date.now() }));
  expect(await user.query(api.accounts.currentViewerAccess, {})).toMatchObject({
    kind: "account",
    role: "role_member",
    status: "active",
    isApproved: false,
    accessKeys: ["access_public", "access_account"],
  });
  await expect(user.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
  await backend.run((ctx) => ctx.db.delete(userId));
  await expect(user.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
});

test("initialization preserves an assigned role and suspension", async () => {
  const { backend, admin, member, memberId } = await setup();
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "role", role: "role_admin" },
  });
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "status", status: "suspended" },
  });
  await backend.mutation(internal.accounts.initialize, { userId: memberId });
  await backend.mutation(internal.accounts.initialize, { userId: memberId });
  expect(await member.query(api.accounts.currentViewerAccess, {})).toMatchObject({
    role: "role_admin",
    status: "suspended",
    accessKeys: ["access_public", "access_account"],
  });
  expect(
    await backend.run((ctx) =>
      ctx.db
        .query("accountAccess")
        .withIndex("by_user_id", (q) => q.eq("userId", memberId))
        .collect(),
    ),
  ).toHaveLength(1);
});

test("bootstrap runs once and cannot restore a later demoted admin", async () => {
  const { backend, admin, memberId } = await setup();
  await backend.mutation(internal.accounts.bootstrapAdmin, { userId: memberId });
  await backend.mutation(internal.accounts.bootstrapAdmin, { userId: memberId });
  const otherId = await backend.run((ctx) =>
    ctx.db.insert("users", { emailVerificationTime: Date.now() }),
  );
  await expect(
    backend.mutation(internal.accounts.bootstrapAdmin, { userId: otherId }),
  ).rejects.toThrow("already complete");
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "role", role: "role_member" },
  });
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "approval", isApproved: false },
  });
  await backend.mutation(internal.accounts.bootstrapAdmin, { userId: memberId });
  const rows = await backend.run((ctx) =>
    ctx.db
      .query("accountAccess")
      .withIndex("by_user_id", (q) => q.eq("userId", memberId))
      .unique(),
  );
  expect(rows).toMatchObject({ role: "role_member", isApproved: false });
  expect(
    await backend.run((ctx) =>
      ctx.db
        .query("accountAccessAudit")
        .withIndex("by_kind", (q) => q.eq("kind", "bootstrap"))
        .collect(),
    ),
  ).toHaveLength(1);
});

test("email confers no authority and direct queries, mutations and actions enforce permissions", async () => {
  const { backend, admin, member, memberId } = await setup();
  await expect(admin.query(api.scout.scouts.list, {})).resolves.toEqual([]);
  await expect(member.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
  await expect(
    member.query(api.accounts.list, { paginationOpts: { numItems: 10, cursor: null } }),
  ).rejects.toThrow("Not authorized");
  await expect(
    member.mutation(api.accounts.changeAccess, {
      userId: memberId,
      change: { kind: "role", role: "role_admin" },
    }),
  ).rejects.toThrow("Not authorized");
  await expect(
    member.mutation(api.scout.chats.sendMessage, { threadId: "known-thread", prompt: "Run" }),
  ).rejects.toThrow("Not authorized");
  await expect(
    member.action(api.scout.manual.executeTool, {
      threadId: "known-thread",
      toolName: "web_search",
      input: JSON.stringify({ query: "example" }),
      operationId: "test-operation",
    }),
  ).rejects.toThrow("Not authorized");
  expect(await backend.run((ctx) => ctx.db.query("scouts").collect())).toEqual([]);
});

test("role changes affect the same session, are audited once, and do not provision Scouts", async () => {
  const { backend, admin, adminId, member, memberId } = await setup();
  const change = {
    userId: memberId,
    change: { kind: "role" as const, role: "role_admin" as const },
  };
  await admin.mutation(api.accounts.changeAccess, change);
  await admin.mutation(api.accounts.changeAccess, change);
  await expect(member.query(api.scout.scouts.list, {})).resolves.toEqual([]);
  const audit = await backend.run((ctx) => ctx.db.query("accountAccessAudit").collect());
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    kind: "change",
    actorUserId: adminId,
    targetUserId: memberId,
    before: { role: "role_member", status: "active" },
    after: { role: "role_admin", status: "active" },
  });
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "status", status: "suspended" },
  });
  await expect(member.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "status", status: "active" },
  });
  await expect(member.query(api.scout.scouts.list, {})).resolves.toEqual([]);
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "role", role: "role_member" },
  });
  await expect(member.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
  expect(await backend.run((ctx) => ctx.db.query("scouts").collect())).toEqual([]);
});

test("the last active admin cannot demote or suspend itself", async () => {
  const { admin, adminId } = await setup();
  await expect(
    admin.mutation(api.accounts.changeAccess, {
      userId: adminId,
      change: { kind: "role", role: "role_member" },
    }),
  ).rejects.toThrow("at least one active approved admin");
  await expect(
    admin.mutation(api.accounts.changeAccess, {
      userId: adminId,
      change: { kind: "approval", isApproved: false },
    }),
  ).rejects.toThrow("at least one active approved admin");
  await expect(
    admin.mutation(api.accounts.changeAccess, {
      userId: adminId,
      change: { kind: "status", status: "suspended" },
    }),
  ).rejects.toThrow("at least one active approved admin");
});

test.each(["role", "approval"] as const)(
  "concurrent %s revocations leave an active approved admin",
  async (kind) => {
    const { backend, admin, adminId, member, memberId } = await setup();
    await admin.mutation(api.accounts.changeAccess, {
      userId: memberId,
      change: { kind: "role", role: "role_admin" },
    });
    const outcomes = await Promise.allSettled([
      admin.mutation(api.accounts.changeAccess, {
        userId: adminId,
        change: kind === "role" ? { kind, role: "role_member" } : { kind, isApproved: false },
      }),
      member.mutation(api.accounts.changeAccess, {
        userId: memberId,
        change: kind === "role" ? { kind, role: "role_member" } : { kind, isApproved: false },
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(
      await backend.run((ctx) =>
        ctx.db
          .query("accountAccess")
          .withIndex("by_role_status_and_approval", (q) =>
            q.eq("role", "role_admin").eq("status", "active").eq("isApproved", true),
          )
          .collect(),
      ),
    ).toHaveLength(1);
  },
);

test("an unverified account cannot become an admin", async () => {
  const { backend, admin, memberId } = await setup();
  await backend.run((ctx) => ctx.db.patch(memberId, { emailVerificationTime: undefined }));
  await expect(
    admin.mutation(api.accounts.changeAccess, {
      userId: memberId,
      change: { kind: "role", role: "role_admin" },
    }),
  ).rejects.toThrow("Verify the account");
});

test("approval grants member permissions, is audited once, and never provisions or promotes", async () => {
  const { backend, admin, adminId } = await setup();
  const userId = await backend.run((ctx) =>
    ctx.db.insert("users", { email: "pending@example.test", emailVerificationTime: Date.now() }),
  );
  await backend.mutation(internal.accounts.initialize, { userId });
  const member = backend.withIdentity({ subject: `${userId}|same-session` });
  await expect(
    admin.mutation(api.accounts.changeAccess, {
      userId,
      change: { kind: "role", role: "role_admin" },
    }),
  ).rejects.toThrow("Approve the account");
  await expect(
    member.mutation(api.accounts.changeAccess, {
      userId,
      change: { kind: "approval", isApproved: true },
    }),
  ).rejects.toThrow("Not authorized");
  await expect(
    member.action(api.scout.manual.executeTool, {
      threadId: "known-thread",
      toolName: "web_search",
      input: "{}",
      operationId: "pending-check",
    }),
  ).rejects.toThrow("Not authorized");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await admin.mutation(api.accounts.changeAccess, {
      userId,
      change: { kind: "approval", isApproved: true },
    });
  }
  expect(await member.query(api.accounts.currentViewerAccess, {})).toMatchObject({
    role: "role_member",
    status: "active",
    isApproved: true,
    accessKeys: ["access_public", "access_account", "access_play", "access_review"],
  });
  await expect(member.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
  const audit = await backend.run((ctx) => ctx.db.query("accountAccessAudit").collect());
  expect(audit).toEqual([
    expect.objectContaining({
      kind: "change",
      actorUserId: adminId,
      targetUserId: userId,
      before: { role: "role_member", status: "active", isApproved: false },
      after: { role: "role_member", status: "active", isApproved: true },
    }),
  ]);
  await admin.mutation(api.accounts.changeAccess, {
    userId,
    change: { kind: "approval", isApproved: false },
  });
  await backend.mutation(internal.accounts.initialize, { userId });
  expect(await member.query(api.accounts.currentViewerAccess, {})).toMatchObject({
    role: "role_member",
    isApproved: false,
    accessKeys: ["access_public", "access_account"],
  });
  const members = await admin.query(api.accounts.list, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(members.page.find((account) => account.userId === userId)).toMatchObject({
    isApproved: false,
    verified: true,
  });
  expect(await backend.run((ctx) => ctx.db.query("scouts").collect())).toEqual([]);
});

test("approval requires verification and does not lift a suspension", async () => {
  const { backend, admin, member, memberId } = await setup();
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "approval", isApproved: false },
  });
  await backend.run((ctx) => ctx.db.patch(memberId, { emailVerificationTime: undefined }));
  await expect(
    admin.mutation(api.accounts.changeAccess, {
      userId: memberId,
      change: { kind: "approval", isApproved: true },
    }),
  ).rejects.toThrow("Verify the account");
  await backend.run((ctx) => ctx.db.patch(memberId, { emailVerificationTime: Date.now() }));
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "status", status: "suspended" },
  });
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "approval", isApproved: true },
  });
  expect(await member.query(api.accounts.currentViewerAccess, {})).toMatchObject({
    role: "role_member",
    status: "suspended",
    isApproved: true,
    accessKeys: ["access_public", "access_account"],
  });
});

test("an unapproved admin cannot act or count towards last-admin protection", async () => {
  const { backend, admin, adminId, member, memberId } = await setup();
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "role", role: "role_admin" },
  });
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "approval", isApproved: false },
  });
  expect(await member.query(api.accounts.currentViewerAccess, {})).toMatchObject({
    role: "role_admin",
    isApproved: false,
    accessKeys: ["access_public", "access_account"],
  });
  await expect(
    member.query(api.accounts.list, { paginationOpts: { numItems: 10, cursor: null } }),
  ).rejects.toThrow("Not authorized");
  await expect(
    member.mutation(api.accounts.changeAccess, {
      userId: memberId,
      change: { kind: "approval", isApproved: true },
    }),
  ).rejects.toThrow("Not authorized");
  await expect(
    admin.mutation(api.accounts.changeAccess, {
      userId: adminId,
      change: { kind: "approval", isApproved: false },
    }),
  ).rejects.toThrow("at least one active approved admin");
  await backend.mutation(internal.accounts.initialize, { userId: memberId });
  await admin.mutation(api.accounts.changeAccess, {
    userId: memberId,
    change: { kind: "approval", isApproved: true },
  });
  await expect(member.query(api.scout.scouts.list, {})).resolves.toEqual([]);
});
