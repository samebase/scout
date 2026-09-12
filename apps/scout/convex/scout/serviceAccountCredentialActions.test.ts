import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { decryptRuntimeManagedPassword } from "./accountTools";

const modules = {
  ...import.meta.glob("../**/*.*s"),
  ...Object.fromEntries(
    Object.entries(
      import.meta.glob([
        "./serviceAccountCredentialActions.ts",
        "./serviceAccountCredentials.ts",
        "./serviceAccounts.ts",
      ]),
    ).map(([path, module]) => [`../scout/${path.slice(2)}`, module]),
  ),
};
const key = Buffer.alloc(32, 7).toString("base64");
const passwordApi = api.scout.serviceAccountCredentialActions.savePassword;
const oauthApi = api.scout.serviceAccounts.saveOAuth;

beforeEach(() => vi.stubEnv("SCOUT_CREDENTIAL_MASTER_KEY_V1", key));
afterEach(() => vi.unstubAllEnvs());

async function context() {
  const backend = convexTest(schema, modules);
  const { userId, scoutId, otherScoutId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scout = {
      displayName: "Magda",
      websiteIdentity: { firstName: "Magda", lastName: "Scout" },
      slug: "magda",
      status: "active" as const,
      agentMail: { inboxId: "magda", address: "magda@example.test" },
      firecrawl: { profileName: "magda" },
    };
    return {
      userId,
      scoutId: await ctx.db.insert("scouts", scout),
      otherScoutId: await ctx.db.insert("scouts", { ...scout, slug: "conrad" }),
    };
  });
  const admin = backend.withIdentity({ subject: `${userId}|test-session` });
  const account = {
    kind: "create" as const,
    scoutId,
    serviceName: "GitHub",
    serviceDomain: "github.com",
    identifier: "magda-scout",
  };
  const args = {
    account,
    credentialHost: "github.com",
    password: { kind: "provided" as const, value: "  my chosen password 🔑  " },
  };
  const credentials = async () =>
    await backend.query(internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout, {
      scoutId,
    });
  return { backend, admin, scoutId, otherScoutId, args, credentials };
}

describe("Profile account login settings", () => {
  it.each(["active", "closing"] as const)(
    "retains a password while its Scout's browser is %s, then permits edits after closure",
    async (kind) => {
      const { admin, backend, scoutId, otherScoutId, args, credentials } = await context();
      const saved = await admin.action(passwordApi, args);
      const sessionId = await backend.run(
        async (ctx) =>
          await ctx.db.insert("scoutBrowserSessions", {
            scoutId,
            threadId: "live-browser",
            sequence: 1,
            provider: "firecrawl",
            providerSessionId: "browser-1",
            profileName: "magda",
            viewport: { width: 1280, height: 800 },
            nextOperationSequence: 1,
            lifecycle: {
              ...(kind === "closing" ? { kind, closingAtMs: 2 } : { kind }),
              openedAtMs: 1,
              providerExpiresAtMs: 3600000,
              cdpUrl: "wss://browser.firecrawl.dev/cdp?token=test",
              interactiveLiveViewUrl: null,
            },
          }),
      );
      const provider = await admin.action(passwordApi, {
        ...args,
        account: { ...args.account, serviceName: "Example", serviceDomain: "example.com" },
        credentialHost: "example.com",
      });
      const before = await credentials();
      const account = {
        kind: "update" as const,
        serviceAccountId: saved.serviceAccountId,
        identifier: "new-identifier",
      };
      await expect(admin.action(passwordApi, { ...args, account })).rejects.toThrow(
        "Close this Scout's browser",
      );
      await expect(
        admin.mutation(oauthApi, { account, providerAccountId: provider.serviceAccountId }),
      ).rejects.toThrow("Close this Scout's browser");
      expect(await credentials()).toEqual(before);

      const other = await admin.action(passwordApi, {
        ...args,
        account: { ...args.account, scoutId: otherScoutId },
      });
      await expect(
        admin.action(passwordApi, {
          ...args,
          account: { ...account, serviceAccountId: other.serviceAccountId },
        }),
      ).resolves.toMatchObject({ serviceAccountId: other.serviceAccountId });

      await backend.run(
        async (ctx) =>
          await ctx.db.patch("scoutBrowserSessions", sessionId, {
            lifecycle: {
              kind: "closed",
              openedAtMs: 1,
              closedAtMs: 3,
              providerDurationMs: null,
              creditsBilled: null,
            },
          }),
      );
      await expect(admin.action(passwordApi, { ...args, account })).resolves.toMatchObject({
        serviceAccountId: saved.serviceAccountId,
      });
      await expect(
        admin.mutation(oauthApi, { account, providerAccountId: provider.serviceAccountId }),
      ).resolves.toEqual({ serviceAccountId: saved.serviceAccountId });
    },
  );

  it.each([
    ["Magda@example.test", "magda@example.test"],
    ["magda-scout", "@magda-scout"],
  ])(
    "rejects equivalent account identifiers %s and %s",
    async (identifier, duplicateIdentifier) => {
      const { admin, args } = await context();
      const github = await admin.action(passwordApi, args);
      const account = {
        ...args.account,
        serviceName: "Cloudflare",
        serviceDomain: "cloudflare.com",
        identifier,
      };
      await admin.mutation(oauthApi, { account, providerAccountId: github.serviceAccountId });
      const duplicate = { ...account, identifier: duplicateIdentifier };
      await expect(
        admin.mutation(oauthApi, {
          account: duplicate,
          providerAccountId: github.serviceAccountId,
        }),
      ).rejects.toThrow("already registered");
      await expect(
        admin.action(passwordApi, {
          ...args,
          account: duplicate,
          credentialHost: "cloudflare.com",
        }),
      ).rejects.toThrow("already registered");
    },
  );

  it.each(["  my chosen password 🔑  ", "密".repeat(1024)])(
    "encrypts the supplied password exactly and returns only metadata (%#)",
    async (password) => {
      const { admin, backend, scoutId, args, credentials } = await context();
      const saved = await admin.action(passwordApi, {
        ...args,
        password: { kind: "provided", value: password },
      });
      const [credential] = await credentials();
      if (!credential) throw new Error("Missing saved credential");
      expect(decryptRuntimeManagedPassword(credential, scoutId, key)).toBe(password);
      expect(saved).toEqual({
        serviceAccountId: credential.serviceAccountId,
        loginMethod: {
          kind: "managed_password",
          credentialHost: "github.com",
          createdAt: credential.createdAt,
        },
      });
      const publicAccounts = await admin.query(api.scout.serviceAccounts.list, { scoutId });
      expect(publicAccounts[0]).toMatchObject({
        authenticationEvidence: { kind: "none" },
        lastObserved: null,
      });
      expect(JSON.stringify(publicAccounts)).not.toContain(credential.ciphertext);
      const stored = await backend.run(async (ctx) => ({
        accounts: await ctx.db.query("scoutServiceAccounts").collect(),
        credentials: await ctx.db.query("scoutManagedCredentials").collect(),
      }));
      expect(JSON.stringify(stored)).not.toContain(password);
    },
  );

  it("replaces a password atomically while preserving account IDs and connected accounts", async () => {
    const { admin, backend, scoutId, args, credentials } = await context();
    const saved = await admin.action(passwordApi, { ...args, password: { kind: "generate" } });
    const linked = await admin.mutation(oauthApi, {
      account: { ...args.account, serviceName: "Cloudflare", serviceDomain: "cloudflare.com" },
      providerAccountId: saved.serviceAccountId,
    });
    const before = await credentials();
    await backend.run(
      async (ctx) =>
        await ctx.db.patch("scoutServiceAccounts", saved.serviceAccountId, {
          authenticationEvidence: { kind: "succeeded", checkedAt: 1 },
        }),
    );
    const updated = await admin.action(passwordApi, {
      ...args,
      account: {
        kind: "update",
        serviceAccountId: saved.serviceAccountId,
        identifier: "magda-new",
      },
      credentialHost: "login.github.com",
    });
    expect(updated.serviceAccountId).toBe(saved.serviceAccountId);
    const after = await credentials();
    expect(after).toHaveLength(1);
    const [credential] = after;
    if (!credential) throw new Error("Missing saved credential");
    expect(credential.credentialReference).not.toBe(before[0]?.credentialReference);
    expect(credential).toMatchObject({
      identifier: "magda-new",
      credentialHost: "login.github.com",
    });
    expect(decryptRuntimeManagedPassword(credential, scoutId, key)).toBe(args.password.value);
    const accounts = await admin.query(api.scout.serviceAccounts.list, { scoutId });
    expect(
      accounts.find((item) => item._id === saved.serviceAccountId)?.authenticationEvidence,
    ).toEqual({ kind: "none" });
    expect(accounts.find((item) => item._id === linked.serviceAccountId)?.loginMethod).toEqual({
      kind: "oauth",
      providerAccountId: saved.serviceAccountId,
    });
    await expect(
      backend.run(async (ctx) => await ctx.db.query("scoutManagedCredentials").collect()),
    ).resolves.toHaveLength(1);
  });

  it("switches login methods without leaving a password behind or changing the account ID", async () => {
    const { admin, backend, args, credentials } = await context();
    const github = await admin.action(passwordApi, args);
    const cloudflare = await admin.action(passwordApi, {
      ...args,
      account: { ...args.account, serviceName: "Cloudflare", serviceDomain: "cloudflare.com" },
      credentialHost: "dash.cloudflare.com",
    });
    const account = {
      kind: "update" as const,
      serviceAccountId: cloudflare.serviceAccountId,
      identifier: args.account.identifier,
    };
    await admin.mutation(oauthApi, { account, providerAccountId: github.serviceAccountId });
    expect(await credentials()).toHaveLength(1);
    await expect(
      backend.run(async (ctx) => await ctx.db.query("scoutManagedCredentials").collect()),
    ).resolves.toHaveLength(1);
    expect(
      await admin.action(passwordApi, { ...args, account, credentialHost: "dash.cloudflare.com" }),
    ).toMatchObject({ serviceAccountId: cloudflare.serviceAccountId });
    expect(await credentials()).toHaveLength(2);
  });

  it("rejects self-links, OAuth cycles, and providers belonging to another Scout without changing credentials", async () => {
    const { admin, otherScoutId, args, credentials } = await context();
    const github = await admin.action(passwordApi, args);
    const linked = await admin.mutation(oauthApi, {
      account: { ...args.account, serviceName: "Cloudflare", serviceDomain: "cloudflare.com" },
      providerAccountId: github.serviceAccountId,
    });
    const other = await admin.action(passwordApi, {
      ...args,
      account: { ...args.account, scoutId: otherScoutId },
    });
    const account = {
      kind: "update" as const,
      serviceAccountId: github.serviceAccountId,
      identifier: args.account.identifier,
    };
    const before = await credentials();
    for (const providerAccountId of [
      github.serviceAccountId,
      linked.serviceAccountId,
      other.serviceAccountId,
    ]) {
      await expect(admin.mutation(oauthApi, { account, providerAccountId })).rejects.toThrow(
        "Choose a provider",
      );
      expect(await credentials()).toEqual(before);
    }
  });

  it("requires admin access for both create and update", async () => {
    const { admin, backend, args } = await context();
    const github = await admin.action(passwordApi, args);
    const otherUserId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: "stranger@example.test" }),
    );
    for (const caller of [
      backend,
      backend.withIdentity({ subject: `${otherUserId}|test-session` }),
    ]) {
      for (const account of [
        args.account,
        {
          kind: "update" as const,
          serviceAccountId: github.serviceAccountId,
          identifier: args.account.identifier,
        },
      ]) {
        await expect(caller.action(passwordApi, { ...args, account })).rejects.toThrow(
          "Not authorized",
        );
        await expect(
          caller.mutation(oauthApi, { account, providerAccountId: github.serviceAccountId }),
        ).rejects.toThrow("Not authorized");
      }
    }
  });

  it("allows an update at capacity but rejects adding another account", async () => {
    const { admin, backend, scoutId, args } = await context();
    const github = await admin.action(passwordApi, args);
    await backend.run(async (ctx) => {
      for (let index = 1; index < 50; index++)
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId,
          serviceName: `Service ${index}`,
          serviceDomain: `service-${index}.example`,
          identifier: "magda",
          authenticationEvidence: { kind: "none" },
          loginMethod: { kind: "oauth", providerAccountId: github.serviceAccountId },
        });
    });
    await expect(
      admin.action(passwordApi, {
        ...args,
        account: {
          kind: "update",
          serviceAccountId: github.serviceAccountId,
          identifier: args.account.identifier,
        },
      }),
    ).resolves.toMatchObject({ serviceAccountId: github.serviceAccountId });
    await expect(
      admin.mutation(oauthApi, {
        account: { ...args.account, serviceDomain: "another.example" },
        providerAccountId: github.serviceAccountId,
      }),
    ).rejects.toThrow("at most 50");
  });

  it.each(["", "x".repeat(1025)])(
    "rejects an invalid password without replacing an existing credential (%#)",
    async (password) => {
      const { admin, args, credentials } = await context();
      const github = await admin.action(passwordApi, args);
      const before = await credentials();
      await expect(
        admin.action(passwordApi, {
          ...args,
          account: {
            kind: "update",
            serviceAccountId: github.serviceAccountId,
            identifier: args.account.identifier,
          },
          password: { kind: "provided", value: password },
        }),
      ).rejects.toMatchObject({ data: "Enter a password between 1 and 1,024 characters." });
      expect(await credentials()).toEqual(before);
    },
  );

  it("reports missing password storage without creating an account", async () => {
    const { admin, args, credentials } = await context();
    vi.stubEnv("SCOUT_CREDENTIAL_MASTER_KEY_V1", undefined);
    await expect(admin.action(passwordApi, args)).rejects.toMatchObject({
      data: "Password storage is not configured for this deployment.",
    });
    expect(await credentials()).toEqual([]);
  });
});
