import { generateKeyPairSync } from "node:crypto";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../../convex/_generated/api";
import { ADMIN_EMAIL, insertTestAccount } from "../../convex/testing/accounts";
import schema from "../../convex/schema";

type ScoutTest = TestConvex<typeof schema>;
const modules = import.meta.glob("../../convex/**/*.*s");

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
    await t.run(async (ctx) => {
      const account = await ctx.db.query("authAccounts").first();
      expect(account?.secret).not.toBe("preview-password-123");
      expect(await ctx.db.query("accountAccess").first()).toMatchObject({
        role: "role_admin",
        status: "active",
        isApproved: true,
      });
      expect(await ctx.db.query("accountAccessAudit").collect()).toHaveLength(1);
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
          email: "  NICU.DEV@GMAIL.COM  ",
          password: "secure-password",
          flow: "signUp",
        },
      }),
    );

    expect(signUp.result.tokens).toBeNull();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("authSessions").collect()).toHaveLength(0);
      expect(await ctx.db.query("accountAccess").first()).toMatchObject({
        role: "role_member",
        status: "active",
        isApproved: false,
      });
      expect(await ctx.db.query("users").first()).toMatchObject({
        email: ADMIN_EMAIL,
      });
      expect(await ctx.db.query("authAccounts").first()).toMatchObject({
        providerAccountId: ADMIN_EMAIL,
      });
    });

    const verified = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: ADMIN_EMAIL,
        code: signUp.code,
        flow: "email-verification",
      },
    });

    expect(verified.tokens).not.toBeNull();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("authSessions").collect()).toHaveLength(1);
      expect(await ctx.db.query("accountAccess").collect()).toEqual([
        expect.objectContaining({ role: "role_member", status: "active", isApproved: false }),
      ]);
      expect(await ctx.db.query("authAccounts").first()).toMatchObject({
        emailVerified: ADMIN_EMAIL,
      });
    });
  });

  it("resets a password only after the emailed code is verified", async () => {
    const t = convexTest(schema, modules);
    await createVerifiedUser(t, ADMIN_EMAIL, "old-password");

    const reset = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: ADMIN_EMAIL,
          flow: "reset",
        },
      }),
    );

    const completed = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: ADMIN_EMAIL,
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
          email: ADMIN_EMAIL,
          password: "old-password",
          flow: "signIn",
        },
      }),
    ).rejects.toThrow();
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: ADMIN_EMAIL,
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
          email: ADMIN_EMAIL,
          password: "secure-password",
          flow: "signUp",
        },
      }),
    );

    const retry = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: ADMIN_EMAIL,
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
          email: ADMIN_EMAIL,
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
      expect(await ctx.db.query("accountAccess").collect()).toEqual([
        expect.objectContaining({ role: "role_member", isApproved: false }),
      ]);
    });
  });

  it("rate-limits repeated password-reset emails", async () => {
    const t = convexTest(schema, modules);
    await createVerifiedUser(t, ADMIN_EMAIL, "secure-password");

    const firstReset = await captureAuthCode(() =>
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: ADMIN_EMAIL,
          flow: "reset",
        },
      }),
    );

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: ADMIN_EMAIL,
          flow: "reset",
        },
      }),
    ).rejects.toThrow("Wait before requesting another password reset code");

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: ADMIN_EMAIL,
          code: firstReset.code,
          newPassword: "replacement-password",
          flow: "reset-verification",
        },
      }),
    ).resolves.toMatchObject({ tokens: expect.any(Object) });
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
    const member = t.withIdentity({ subject: `${user._id}|session` });
    expect(await member.query(api.accounts.currentViewerAccess, {})).toEqual({
      kind: "account",
      userId: user._id,
      role: "role_member",
      status: "active",
      isApproved: false,
      accessKeys: ["access_public", "access_account"],
    });
    await expect(member.query(api.scout.scouts.list, {})).rejects.toThrow("Not authorized");
    await expect(
      member.mutation(api.accounts.changeAccess, {
        userId: user._id,
        change: { kind: "approval", isApproved: true },
      }),
    ).rejects.toThrow("Not authorized");
  });

  it.each([true, false])(
    "login and password recovery preserve approval=%s, role, and suspension",
    async (isApproved) => {
      const t = convexTest(schema, modules);
      const email = "returning-member@example.test";
      await createVerifiedUser(t, email, "old-password");
      const user = await t.run((ctx) => ctx.db.query("users").unique());
      if (!user) throw new Error("Expected verified user");
      await t.mutation(internal.accounts.bootstrapAdmin, { userId: user._id });
      const adminId = await t.run((ctx) =>
        insertTestAccount(ctx, { email: "admin@example.test", role: "role_admin" }),
      );
      const admin = t.withIdentity({ subject: `${adminId}|session` });
      await admin.mutation(api.accounts.changeAccess, {
        userId: user._id,
        change: { kind: "approval", isApproved },
      });
      await admin.mutation(api.accounts.changeAccess, {
        userId: user._id,
        change: { kind: "status", status: "suspended" },
      });
      const viewer = t.withIdentity({ subject: `${user._id}|session` });
      const expected = {
        role: "role_admin",
        status: "suspended",
        isApproved,
        accessKeys: ["access_public", "access_account"],
      };
      await expect(
        t.action(api.auth.signIn, {
          provider: "password",
          params: {
            email,
            password: "old-password",
            flow: "signIn",
            isApproved: true,
            role: "role_member",
          },
        }),
      ).resolves.toMatchObject({ tokens: expect.any(Object) });
      expect(await viewer.query(api.accounts.currentViewerAccess, {})).toMatchObject(expected);
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
            isApproved: true,
            role: "role_member",
          },
        }),
      ).resolves.toMatchObject({ tokens: expect.any(Object) });
      expect(await viewer.query(api.accounts.currentViewerAccess, {})).toMatchObject(expected);
    },
  );

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
          email: ADMIN_EMAIL,
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
  vi.unstubAllGlobals();
  if (!code) {
    throw new Error("Expected an eight-digit authentication code");
  }
  return { code, result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
