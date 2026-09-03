import { generateKeyPairSync } from "node:crypto";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../../convex/_generated/api";
import { ADMIN_EMAIL } from "../../convex/authConfig";
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
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("DEV_SEED_AUTH_EMAIL", "preview@example.com");
    vi.stubEnv("DEV_SEED_AUTH_PASSWORD", "preview-password-123");

    await expect(t.action(internal.devAuth.seedPasswordAccount, {})).resolves.toEqual({
      created: true,
      email: "preview@example.com",
    });
    await t.run(async (ctx) => {
      const account = await ctx.db.query("authAccounts").first();
      expect(account?.secret).not.toBe("preview-password-123");
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

  it("does not seed or admit a development account unless seeding is enabled", async () => {
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
    ).rejects.toThrow("Scout is currently restricted to the administrator");
  });

  it("blocks seed account creation and recovery flows", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("DEV_SEED_AUTH_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
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

  it("refuses to seed any remote deployment", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("CONVEX_CLOUD_URL", "https://preview.convex.cloud");
    vi.stubEnv("DEV_SEED_AUTH_ENABLED", "true");
    vi.stubEnv("DEV_SEED_AUTH_EMAIL", "preview@example.com");
    vi.stubEnv("DEV_SEED_AUTH_PASSWORD", "preview-password-123");
    await expect(t.action(internal.devAuth.seedPasswordAccount, {})).rejects.toThrow(
      "Development password account seeding requires a local backend",
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

  it("rejects accounts other than the configured administrator", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: "someone@example.com",
          password: "secure-password",
          flow: "signUp",
        },
      }),
    ).rejects.toThrow("Scout is currently restricted to the administrator");

    await t.run(async (ctx) => {
      expect(await ctx.db.query("users").first()).toBeNull();
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
