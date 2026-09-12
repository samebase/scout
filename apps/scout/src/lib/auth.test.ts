import { generateKeyPairSync } from "node:crypto";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../../convex/_generated/api";
import { ADMIN_EMAIL, insertTestAccount } from "../../convex/testing/accounts";
import schema from "../../convex/schema";
import { AUTH_EMAIL_COOLDOWN } from "../../shared/auth";
import type { Doc } from "../../convex/_generated/dataModel";

type ScoutTest = TestConvex<typeof schema>;
const modules = import.meta.glob("../../convex/**/*.*s");
const MEMBER_EMAIL = "member@example.test";

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  process.env["SITE_URL"] = "http://localhost:5173";
  process.env["CONVEX_SITE_URL"] = "https://scout-test.convex.site";
  process.env["JWT_PRIVATE_KEY"] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString()
    .trimEnd()
    .replace(/\n/g, " ");
  process.env["JWKS"] = JSON.stringify({
    keys: [{ use: "sig", ...publicKey.export({ format: "jwk" }) }],
  });
  process.env["CLOUDFLARE_EMAIL_ACCOUNT_ID"] = "test-account-id";
  process.env["CLOUDFLARE_EMAIL_API_TOKEN"] = "test-email-token";
  process.env["AUTH_LOG_LEVEL"] = "ERROR";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("password authentication", () => {
  it("seeds one verified development account idempotently", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("DEV_SEED_AUTH_ENABLED", "true");
    vi.stubEnv("DEV_SEED_AUTH_EMAIL", "preview@example.com");
    vi.stubEnv("DEV_SEED_AUTH_PASSWORD", "preview-password-123");

    await expect(t.action(internal.devAuth.seedPasswordAccount, {})).resolves.toEqual({
      created: true,
      email: "preview@example.com",
    });
    const seedUserId = await t.run(async (ctx) => {
      const account = await ctx.db.query("authAccounts").first();
      expect(account?.secret).not.toBe("preview-password-123");
      const user = await ctx.db.query("users").unique();
      if (!user) throw new Error("Expected the seed account to create a user");
      expectPersistedApproval(user, true);
      return user._id;
    });
    const seedViewer = t.withIdentity({ subject: `${seedUserId}|session` });
    await expect(seedViewer.query(api.accounts.currentViewerAccess, {})).resolves.toEqual({
      kind: "account",
      userId: seedUserId,
      role: "role_member",
      isApproved: true,
      accessKeys: ["access_public", "access_account", "access_play", "access_review"],
    });

    vi.stubEnv("DEV_SEED_AUTH_PASSWORD", "replacement-password-456");
    await expect(t.action(internal.devAuth.seedPasswordAccount, {})).resolves.toEqual({
      created: false,
      email: "preview@example.com",
    });
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: "preview@example.com",
          password: "preview-password-123",
          flow: "signIn",
        },
      }),
    ).rejects.toThrow();
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: "preview@example.com",
          password: "replacement-password-456",
          flow: "signIn",
        },
      }),
    ).resolves.toMatchObject({ tokens: expect.any(Object) });
  });

  it("does not create a development account when seeding is disabled", async () => {
    const t = convexTest(schema, modules);

    await expect(t.action(internal.devAuth.seedPasswordAccount, {})).rejects.toThrow(
      "Development password account seeding is disabled",
    );
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: "preview@example.com",
          password: "preview-password-123",
          flow: "signIn",
        },
      }),
    ).rejects.toThrow();
  });

  it("blocks seed account creation and recovery flows", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("DEV_SEED_AUTH_ENABLED", "true");
    vi.stubEnv("DEV_SEED_AUTH_EMAIL", "preview@example.com");
    vi.stubEnv("DEV_SEED_AUTH_PASSWORD", "preview-password-123");

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: "preview@example.com",
          password: "another-password",
          flow: "signUp",
        },
      }),
    ).rejects.toThrow("The development seed account only allows password sign-in");
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: "preview@example.com",
          flow: "reset",
        },
      }),
    ).rejects.toThrow("The development seed account only allows password sign-in");
  });

  it("refuses to seed a production deployment", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:scout-production");
    vi.stubEnv("DEV_SEED_AUTH_ENABLED", "true");
    vi.stubEnv("DEV_SEED_AUTH_EMAIL", "preview@example.com");
    vi.stubEnv("DEV_SEED_AUTH_PASSWORD", "preview-password-123");

    await expect(t.action(internal.devAuth.seedPasswordAccount, {})).rejects.toThrow(
      "Development password account seeding is disabled in production",
    );
  });

  it("normalizes the email and requires its code before creating a session", async () => {
    const t = convexTest(schema, modules);
    const signUp = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: "  MEMBER@EXAMPLE.TEST  ",
          password: "secure-password",
          flow: "signUp",
        },
      }),
    );

    expect(signUp.result.tokens).toBeNull();
    const userId = await t.run(async (ctx) => {
      expect(await ctx.db.query("authSessions").collect()).toHaveLength(0);
      const user = await ctx.db.query("users").unique();
      if (!user) throw new Error("Expected signup to create a user");
      expect(user).toMatchObject({ email: MEMBER_EMAIL });
      expectPersistedApproval(user, false);
      expect(await ctx.db.query("authAccounts").first()).toMatchObject({
        providerAccountId: MEMBER_EMAIL,
      });
      return user._id;
    });

    const verified = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: MEMBER_EMAIL,
        code: signUp.code,
        flow: "email-verification",
      },
    });

    expect(verified.tokens).not.toBeNull();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("authSessions").collect()).toHaveLength(1);
      const user = await ctx.db.get(userId);
      if (!user) throw new Error("Expected verified user");
      expectPersistedApproval(user, false);
      expect(await ctx.db.query("authAccounts").first()).toMatchObject({
        emailVerified: MEMBER_EMAIL,
      });
    });
    const pending = t.withIdentity({ subject: `${userId}|session` });
    await expect(pending.query(api.accounts.currentViewerAccess, {})).resolves.toEqual({
      kind: "account",
      userId,
      role: "role_pending_access",
      isApproved: false,
      accessKeys: ["access_public", "access_account"],
    });
  });

  it("resets a password only after the emailed code is verified", async () => {
    const t = convexTest(schema, modules);
    await createVerifiedUser(t, MEMBER_EMAIL, "old-password");

    const reset = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          flow: "reset",
        },
      }),
    );

    const completed = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: MEMBER_EMAIL,
        code: reset.code,
        newPassword: "new-password",
        flow: "reset-verification",
      },
    });
    expect(completed.tokens).not.toBeNull();

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          password: "old-password",
          flow: "signIn",
        },
      }),
    ).rejects.toThrow();
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          password: "new-password",
          flow: "signIn",
        },
      }),
    ).resolves.toMatchObject({ tokens: expect.any(Object) });
  });

  it("resends verification when an unverified account signs in", async () => {
    const t = convexTest(schema, modules);
    await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          password: "secure-password",
          flow: "signUp",
        },
      }),
    );

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    const retry = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          password: "secure-password",
          flow: "signIn",
        },
      }),
    );
    expect(retry.result.tokens).toBeNull();

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          code: retry.code,
          flow: "email-verification",
        },
      }),
    ).resolves.toMatchObject({ tokens: expect.any(Object) });
  });

  it("recovers an interrupted signup after the deployment's SITE_URL is configured", async () => {
    const t = convexTest(schema, modules);
    const email = "interrupted-signup@example.test";
    vi.stubEnv("SITE_URL", undefined);
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email, password: "secure-password", flow: "signUp" },
      }),
    ).rejects.toThrow("Missing environment variable `SITE_URL`");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("users").collect()).toHaveLength(1);
      expect(await ctx.db.query("authSessions").collect()).toHaveLength(0);
    });

    vi.stubEnv("SITE_URL", "https://feature-scout.example.workers.dev");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    const retry = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email, password: "secure-password", flow: "signIn" },
      }),
    );
    expect(retry.result.tokens).toBeNull();
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email, code: retry.code, flow: "email-verification" },
      }),
    ).resolves.toMatchObject({ tokens: expect.any(Object) });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("users").collect()).toHaveLength(1);
      const user = await ctx.db.query("users").unique();
      if (!user) throw new Error("Expected interrupted signup to preserve its user");
      expectPersistedApproval(user, false);
    });
  });

  it("rate-limits repeated password-reset emails", async () => {
    const t = convexTest(schema, modules);
    await createVerifiedUser(t, MEMBER_EMAIL, "secure-password");

    const firstReset = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          flow: "reset",
        },
      }),
    );

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          flow: "reset",
        },
      }),
    ).rejects.toThrow(AUTH_EMAIL_COOLDOWN);

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          code: firstReset.code,
          newPassword: "replacement-password",
          flow: "reset-verification",
        },
      }),
    ).resolves.toMatchObject({ tokens: expect.any(Object) });
  });

  it.each([
    { flow: "email-verification" },
    { flow: "reset-verification", newPassword: "replacement-password" },
  ])("rejects code-less $flow without sending mail or replacing a reset code", async (params) => {
    const t = convexTest(schema, modules);
    await createVerifiedUser(t, MEMBER_EMAIL, "secure-password");
    const reset = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, flow: "reset" },
      }),
    );
    const send = vi.fn(() => {
      throw new Error("Unexpected email dispatch");
    });
    vi.stubGlobal("fetch", send);
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, ...params },
      }),
    ).rejects.toThrow("Enter the verification code");
    expect(send).not.toHaveBeenCalled();
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          code: reset.code,
          newPassword: "replacement-password",
          flow: "reset-verification",
        },
      }),
    ).resolves.toMatchObject({ tokens: expect.any(Object) });
  });

  it("does not consume the email cooldown for an invalid signup", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, password: "short", flow: "signUp" },
      }),
    ).rejects.toThrow("Invalid password");

    const signUp = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, password: "secure-password", flow: "signUp" },
      }),
    );
    expect(signUp.result.tokens).toBeNull();
  });

  it("does not consume the email cooldown for invalid unverified sign-in attempts", async () => {
    const t = convexTest(schema, modules);
    await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, password: "secure-password", flow: "signUp" },
      }),
    );
    const retryAt = Date.now() + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(retryAt);
    const send = vi.fn(() => {
      throw new Error("Unexpected email dispatch");
    });
    vi.stubGlobal("fetch", send);

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, password: "wrong-password", flow: "signIn" },
      }),
    ).rejects.toThrow();
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, flow: "signIn" },
      }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();

    const retry = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, password: "secure-password", flow: "signIn" },
      }),
    );
    expect(retry.result.tokens).toBeNull();
  });

  it("throttles unverified sign-in resends while keeping the first code and verified sign-in usable", async () => {
    const t = convexTest(schema, modules);
    const signUp = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, password: "secure-password", flow: "signUp" },
      }),
    );
    const send = vi.fn(() => {
      throw new Error("Unexpected email dispatch");
    });
    vi.stubGlobal("fetch", send);
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, password: "secure-password", flow: "signIn" },
      }),
    ).rejects.toThrow(AUTH_EMAIL_COOLDOWN);
    expect(send).not.toHaveBeenCalled();
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: MEMBER_EMAIL, code: signUp.code, flow: "email-verification" },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        t.action(api.auth.signIn, {
          provider: "password",
          params: { email: MEMBER_EMAIL, password: "secure-password", flow: "signIn" },
        }),
      ).resolves.toMatchObject({ tokens: expect.any(Object) });
    }
  });

  it("allows public signup but ignores attempts to approve or promote the account", async () => {
    const t = convexTest(schema, modules);
    const email = "new-member@example.test";
    const signUp = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email,
          password: "secure-password",
          flow: "signUp",
          isApproved: true,
          role: "role_admin",
        },
      }),
    );
    expect(signUp.result.tokens).toBeNull();
    const verified = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email,
        code: signUp.code,
        flow: "email-verification",
        isApproved: true,
        role: "role_admin",
      },
    });
    expect(verified.tokens).not.toBeNull();
    const user = await t.run((ctx) => ctx.db.query("users").unique());
    if (!user) throw new Error("Expected signup to create a user");
    expectPersistedApproval(user, false);
    const pending = t.withIdentity({ subject: `${user._id}|session` });
    expect(await pending.query(api.accounts.currentViewerAccess, {})).toEqual({
      kind: "account",
      userId: user._id,
      role: "role_pending_access",
      isApproved: false,
      accessKeys: ["access_public", "access_account"],
    });
    await expect(pending.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
    await expect(
      pending.mutation(api.accounts.setApproval, {
        userId: user._id,
        isApproved: true,
      }),
    ).rejects.toThrow("Not authorized");
  });

  it.each([ADMIN_EMAIL, "nicu@samebase.com"])(
    "derives staff access for allowlisted account %s independently of approval",
    async (email) => {
      const t = convexTest(schema, modules);
      await createVerifiedUser(t, email, "secure-password");
      const user = await t.run((ctx) => ctx.db.query("users").unique());
      if (!user) throw new Error("Expected staff signup to create a user");
      expectPersistedApproval(user, false);
      const staff = t.withIdentity({ subject: `${user._id}|session` });
      const staffAccess = {
        kind: "account" as const,
        userId: user._id,
        role: "role_staff" as const,
        accessKeys: [
          "access_public",
          "access_account",
          "access_play",
          "access_review",
          "access_lab",
          "access_scout_manage",
          "access_members_manage",
        ],
      };
      await expect(staff.query(api.accounts.currentViewerAccess, {})).resolves.toEqual({
        ...staffAccess,
        isApproved: false,
      });

      await staff.mutation(api.accounts.setApproval, { userId: user._id, isApproved: true });
      await expect(staff.query(api.accounts.currentViewerAccess, {})).resolves.toEqual({
        ...staffAccess,
        isApproved: true,
      });
      const approved = await t.run((ctx) => ctx.db.get(user._id));
      if (!approved) throw new Error("Expected staff user");
      expectPersistedApproval(approved, true);
    },
  );

  it.each([true, false])("login and password recovery preserve approval=%s", async (isApproved) => {
    const t = convexTest(schema, modules);
    const email = "returning-member@example.test";
    await createVerifiedUser(t, email, "old-password");
    const user = await t.run((ctx) => ctx.db.query("users").unique());
    if (!user) throw new Error("Expected verified user");
    const staffId = await t.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
    const staff = t.withIdentity({ subject: `${staffId}|session` });
    await staff.mutation(api.accounts.setApproval, {
      userId: user._id,
      isApproved,
    });
    const viewer = t.withIdentity({ subject: `${user._id}|session` });
    const expected = {
      kind: "account" as const,
      userId: user._id,
      role: isApproved ? ("role_member" as const) : ("role_pending_access" as const),
      isApproved,
      accessKeys: isApproved
        ? ["access_public", "access_account", "access_play", "access_review"]
        : ["access_public", "access_account"],
    };
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email,
          password: "old-password",
          flow: "signIn",
          isApproved: !isApproved,
          role: "role_staff",
        },
      }),
    ).resolves.toMatchObject({ tokens: expect.any(Object) });
    expect(await viewer.query(api.accounts.currentViewerAccess, {})).toEqual(expected);
    const afterLogin = await t.run((ctx) => ctx.db.get(user._id));
    if (!afterLogin) throw new Error("Expected returning user after login");
    expectPersistedApproval(afterLogin, isApproved);
    const reset = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email, flow: "reset" },
      }),
    );
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email,
          code: reset.code,
          newPassword: "new-password",
          flow: "reset-verification",
          isApproved: !isApproved,
          role: "role_staff",
        },
      }),
    ).resolves.toMatchObject({ tokens: expect.any(Object) });
    expect(await viewer.query(api.accounts.currentViewerAccess, {})).toEqual(expected);
    const afterRecovery = await t.run((ctx) => ctx.db.get(user._id));
    if (!afterRecovery) throw new Error("Expected returning user after password recovery");
    expectPersistedApproval(afterRecovery, isApproved);
  });

  it("refuses a password session for a deleted user even if credentials still exist", async () => {
    const t = convexTest(schema, modules);
    await createVerifiedUser(t, MEMBER_EMAIL, "secure-password");
    const userId = await t.run(async (ctx) => {
      const user = await ctx.db.query("users").unique();
      if (!user) throw new Error("Expected a verified account");
      await ctx.db.replace(user._id, { state: "deleted", deletedAt: Date.now() });
      return user._id;
    });

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: MEMBER_EMAIL, password: "secure-password", flow: "signIn" },
      }),
    ).rejects.toThrow("This account is being deleted or has been deleted");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("authSessions").collect()).toHaveLength(1);
      expect(await ctx.db.get(userId)).toMatchObject({ state: "deleted" });
    });
  });

  it("does not configure anonymous authentication", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.auth.signIn, {
        provider: "anonymous",
        params: {},
      }),
    ).rejects.toThrow("Provider `anonymous` is not configured");
  });

  it("blocks password flows while debug logging is enabled", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("AUTH_LOG_LEVEL", "DEBUG");

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: MEMBER_EMAIL,
          password: "secure-password",
          flow: "signUp",
        },
      }),
    ).rejects.toThrow("Password authentication is disabled while AUTH_LOG_LEVEL is DEBUG");
  });
});

async function createVerifiedUser(t: ScoutTest, email: string, password: string) {
  const signUp = await captureAuthCode(() =>
    t.action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signUp" },
    }),
  );

  await t.action(api.auth.signIn, {
    provider: "password",
    params: {
      email,
      code: signUp.code,
      flow: "email-verification",
    },
  });
}

function expectPersistedApproval(user: Doc<"users">, isApproved: boolean) {
  expect(user).toMatchObject({ isApproved });
  expect(user).not.toHaveProperty("role");
  expect(user).not.toHaveProperty("status");
}

async function captureAuthCode<Result>(operation: () => Promise<Result>) {
  let code: string | null = null;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (
        url !== "https://api.cloudflare.com/client/v4/accounts/test-account-id/email/sending/send"
      ) {
        throw new Error(`Unexpected request to ${url}`);
      }
      expect(init?.headers).toEqual({
        Authorization: "Bearer test-email-token",
        "Content-Type": "application/json",
      });
      if (typeof init?.body !== "string") {
        throw new Error("Expected a JSON request body");
      }

      const payload: unknown = JSON.parse(init.body);
      if (!isRecord(payload)) {
        throw new Error("Expected an email request object");
      }
      const text = typeof payload["text"] === "string" ? payload["text"] : "";
      const html = typeof payload["html"] === "string" ? payload["html"] : "";
      code = `${text}\n${html}`.match(/\b\d{8}\b/)?.[0] ?? null;

      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: {
            delivered: ["person@example.com"],
            permanent_bounces: [],
            queued: [],
          },
        }),
        { status: 200 },
      );
    }),
  );

  const result = await operation();
  vi.stubGlobal("fetch", () => {
    throw new Error("Unexpected email dispatch outside captureAuthCode");
  });
  if (!code) {
    throw new Error("Expected an eight-digit authentication code");
  }
  return { code, result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
