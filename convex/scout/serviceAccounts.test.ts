import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ADMIN_EMAIL } from "../authConfig";
import schema from "../schema";

const modules = {
  ...import.meta.glob("../**/*.*s"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./serviceAccounts.ts")).map(([path, module]) => [
      `../scout/${path.slice(2)}`,
      module,
    ]),
  ),
};
const serviceAccountsApi = anyApi["scout"]["serviceAccounts"];

function testBackend() {
  return convexTest(schema, modules);
}

async function insertUser(backend: ReturnType<typeof testBackend>, email: string) {
  return await backend.run(async (ctx) => await ctx.db.insert("users", { email }));
}

async function insertScout(backend: ReturnType<typeof testBackend>, slug: string) {
  return await backend.run(
    async (ctx) =>
      await ctx.db.insert("scouts", {
        displayName: `${slug} Scout`,
        websiteIdentity: { firstName: slug, lastName: "Scout" },
        slug,
        status: "active",
        agentMail: {
          inboxId: `${slug}-inbox`,
          address: `${slug}@example.test`,
        },
        firecrawl: { profileName: `${slug}-profile` },
      }),
  );
}

async function insertManagedAccount(
  backend: ReturnType<typeof testBackend>,
  args: {
    scoutId: Id<"scouts">;
    serviceName: string;
    serviceDomain: string;
    identifier: string;
  },
) {
  return await backend.run(async (ctx) => {
    const productId = await ctx.db.insert("products", {
      name: args.serviceName,
      domain: args.serviceDomain,
      primaryUrl: `https://${args.serviceDomain}`,
    });
    return await ctx.db.insert("scoutServiceAccounts", {
      scoutId: args.scoutId,
      productId,
      serviceName: args.serviceName,
      serviceDomain: args.serviceDomain,
      identifier: args.identifier,
      authenticationEvidence: { kind: "none" },
      loginMethod: {
        kind: "managed_password",
        credentialHost: args.serviceDomain,
        createdAt: 1,
      },
    });
  });
}

async function authenticatedBackend() {
  const backend = testBackend();
  const adminId = await insertUser(backend, ADMIN_EMAIL);
  return {
    backend,
    admin: backend.withIdentity({ subject: `${adminId}|test-session` }),
    userId: adminId,
  };
}

async function insertTaskBrowserEvidence(
  backend: ReturnType<typeof testBackend>,
  args: {
    userId: Id<"users">;
    scoutId: Id<"scouts">;
    productId: Id<"products">;
    observedUrl: string;
  },
) {
  return await backend.run(async (ctx) => {
    const taskId = await ctx.db.insert("productTasks", {
      userId: args.userId,
      productId: args.productId,
      instruction: "Create an account.",
    });
    const threadId = "task-thread";
    const attemptId = await ctx.db.insert("taskAttempts", {
      taskId,
      scoutId: args.scoutId,
      threadId,
      browserProfile: { kind: "scout", profileName: "conrad-profile" },
      state: { kind: "active" },
    });
    const promptMessageId = "prompt-message";
    const turnId = await ctx.db.insert("scoutTurns", {
      threadId,
      order: 1,
      promptMessageId,
      scoutId: args.scoutId,
      model: "qwen/qwen3.7-flash",
      startedAt: 1,
      state: { kind: "pending", leaseExpiresAt: 10_000 },
    });
    const sessionId = await ctx.db.insert("taskBrowserSessions", {
      attemptId,
      turnId,
      sequence: 1,
      provider: "firecrawl",
      providerSessionId: "provider-session",
      profileName: "conrad-profile",
      viewport: { width: 1_280, height: 800 },
      nextOperationSequence: 2,
      lifecycle: { kind: "active", openedAtMs: 1 },
    });
    const telemetry = {
      version: 1 as const,
      before: { capturedAtMs: 1, tabs: [] },
      dispatchedAtMs: 2,
      returnedAtMs: 3,
      after: {
        capturedAtMs: 3,
        tabs: [
          {
            tabId: "tab-1",
            title: "Authenticated product",
            url: args.observedUrl,
            active: true,
          },
        ],
      },
      pointer: null,
    };
    await ctx.db.insert("taskBrowserOperations", {
      sessionId,
      sequence: 1,
      toolCallId: "browser-open",
      action: { kind: "open", url: args.observedUrl },
      state: { kind: "applied", settledAtMs: 3, telemetry },
    });
    return { promptMessageId, taskId, attemptId, turnId, sessionId };
  });
}

describe("Scout service-account inventory", () => {
  it("rejects unauthenticated and non-admin access", async () => {
    const backend = testBackend();
    const scoutId = await insertScout(backend, "conrad");
    const providerAccountId = await insertManagedAccount(backend, {
      scoutId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "conrad-scout",
    });
    const registration = {
      scoutId,
      serviceName: "Tally",
      serviceDomain: "tally.so",
      identifier: "other@example.test",
      providerAccountId,
    };

    await expect(backend.query(serviceAccountsApi["list"], {})).rejects.toThrow("Not authorized");
    await expect(
      backend.mutation(serviceAccountsApi["registerOauth"], registration),
    ).rejects.toThrow("Not authorized");

    const nonAdminId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(nonAdmin.query(serviceAccountsApi["list"], {})).rejects.toThrow("Not authorized");
    await expect(
      nonAdmin.mutation(serviceAccountsApi["registerOauth"], registration),
    ).rejects.toThrow("Not authorized");
  });

  it("normalizes registration fields and returns safe projections", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    const providerAccountId = await insertManagedAccount(backend, {
      scoutId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "conrad-scout",
    });

    const result = await admin.mutation(serviceAccountsApi["registerOauth"], {
      scoutId,
      serviceName: "  Tally  ",
      serviceDomain: "  HTTPS://TALLY.SO/forms/example  ",
      identifier: "  CONRAD@AGENTMAIL.TO  ",
      providerAccountId,
    });

    const accounts = await admin.query(serviceAccountsApi["list"], { scoutId });
    expect(
      accounts.find((account: { _id: string }) => account._id === result.serviceAccountId),
    ).toEqual({
      _id: result.serviceAccountId,
      scoutId,
      serviceName: "Tally",
      serviceDomain: "tally.so",
      identifier: "CONRAD@AGENTMAIL.TO",
      authenticationEvidence: { kind: "none" },
      loginMethod: { kind: "oauth", providerAccountId },
      firstRecordedByTask: null,
      lastVerifiedByTask: null,
    });
  });

  it("requires an existing Scout", async () => {
    const { backend, admin } = await authenticatedBackend();
    const missingScoutId = await insertScout(backend, "temporary");
    const providerAccountId = await insertManagedAccount(backend, {
      scoutId: missingScoutId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "temporary-scout",
    });
    await backend.run(async (ctx) => await ctx.db.delete(missingScoutId));

    await expect(
      admin.mutation(serviceAccountsApi["registerOauth"], {
        scoutId: missingScoutId,
        serviceName: "Tally",
        serviceDomain: "tally.so",
        identifier: "conrad@example.test",
        providerAccountId,
      }),
    ).rejects.toThrow("Scout not found");
  });

  it("rejects canonical domain duplicates while preserving identifier case", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    const providerAccountId = await insertManagedAccount(backend, {
      scoutId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "conrad-scout",
    });
    const first = {
      scoutId,
      serviceName: "Tally",
      serviceDomain: "tally.so",
      identifier: "conrad@example.test",
      providerAccountId,
    };
    await admin.mutation(serviceAccountsApi["registerOauth"], first);

    await expect(
      admin.mutation(serviceAccountsApi["registerOauth"], {
        ...first,
        serviceName: "Tally Forms",
        serviceDomain: "HTTPS://TALLY.SO/",
        identifier: "  conrad@example.test  ",
      }),
    ).rejects.toThrow("already registered");
    await expect(
      admin.mutation(serviceAccountsApi["registerOauth"], {
        ...first,
        identifier: "CONRAD@EXAMPLE.TEST",
      }),
    ).resolves.toEqual({ serviceAccountId: expect.any(String) });
  });

  it.each([
    "foo..com",
    "foo_bar.com",
    "-foo.com",
    "foo-.com",
    `${"a".repeat(64)}.com`,
    `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
  ])("rejects an invalid service domain: %s", async (serviceDomain) => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    const providerAccountId = await insertManagedAccount(backend, {
      scoutId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "conrad-scout",
    });

    await expect(
      admin.mutation(serviceAccountsApi["registerOauth"], {
        scoutId,
        serviceName: "Example",
        serviceDomain,
        identifier: "conrad@example.test",
        providerAccountId,
      }),
    ).rejects.toThrow("Service domain must be a valid hostname or URL");
  });

  it("filters accounts by Scout", async () => {
    const { backend, admin } = await authenticatedBackend();
    const conradId = await insertScout(backend, "conrad");
    const adaId = await insertScout(backend, "ada");
    await insertManagedAccount(backend, {
      scoutId: conradId,
      serviceName: "Tally",
      serviceDomain: "tally.so",
      identifier: "conrad@example.test",
    });
    await insertManagedAccount(backend, {
      scoutId: adaId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "ada-scout",
    });

    const conradAccounts = await admin.query(serviceAccountsApi["list"], { scoutId: conradId });
    expect(conradAccounts).toHaveLength(1);
    expect(conradAccounts[0]).toMatchObject({ scoutId: conradId, serviceName: "Tally" });
    const allAccounts = await admin.query(serviceAccountsApi["list"], {});
    expect(allAccounts).toHaveLength(2);
    expect(new Set(allAccounts.map((account: { scoutId: string }) => account.scoutId))).toEqual(
      new Set([conradId, adaId]),
    );
  });

  it("records a newly created account for the Task product", async () => {
    const { backend, admin, userId } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    const providerAccountId = await insertManagedAccount(backend, {
      scoutId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "conrad-scout",
    });
    const productId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("products", {
          name: "Convex",
          domain: "convex.dev",
          primaryUrl: "https://convex.dev",
        }),
    );
    const observedUrl = "https://dashboard.convex.dev/t/conrad-5bce5";
    const context = await insertTaskBrowserEvidence(backend, {
      userId,
      scoutId,
      productId,
      observedUrl,
    });

    const result = await backend.mutation(
      internal.scout.serviceAccounts.recordAuthenticatedFromTask,
      {
        promptMessageId: context.promptMessageId,
        accountAccess: "created",
        observedUrl,
        visibleIdentity: "Account\nconrad@example.test",
        visibleSessionControl: "Log out",
        loginMethod: {
          kind: "oauth",
          providerServiceDomain: "github.com",
          providerIdentifier: "conrad-scout",
        },
      },
    );

    expect(result).toEqual({ serviceAccountId: expect.any(String), created: true });
    await expect(admin.query(serviceAccountsApi["list"], { scoutId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: result.serviceAccountId,
          scoutId,
          serviceName: "Convex",
          serviceDomain: "convex.dev",
          identifier: "conrad@example.test",
          authenticationEvidence: { kind: "succeeded", checkedAt: expect.any(Number) },
          loginMethod: { kind: "oauth", providerAccountId },
          firstRecordedByTask: expect.objectContaining({
            taskId: context.taskId,
            attemptId: context.attemptId,
            turnId: context.turnId,
            sessionId: context.sessionId,
            observedUrl,
            visibleIdentity: "Account\nconrad@example.test",
            visibleSessionControl: "Log out",
            accountAccess: "created",
          }),
        }),
      ]),
    );
  });

  it("does not treat a team label as the Scout's account identity", async () => {
    const { backend, userId } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    await insertManagedAccount(backend, {
      scoutId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "conrad-scout",
    });
    const productId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("products", {
          name: "Convex",
          domain: "convex.dev",
          primaryUrl: "https://convex.dev",
        }),
    );
    const observedUrl = "https://dashboard.convex.dev/t/conrad-5bce5";
    const context = await insertTaskBrowserEvidence(backend, {
      userId,
      scoutId,
      productId,
      observedUrl,
    });

    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticatedFromTask, {
        promptMessageId: context.promptMessageId,
        accountAccess: "created",
        observedUrl,
        visibleIdentity: "Team Settings\nconrad's team",
        visibleSessionControl: "Log out",
        loginMethod: {
          kind: "oauth",
          providerServiceDomain: "github.com",
          providerIdentifier: "conrad-scout",
        },
      }),
    ).rejects.toThrow("Visible account identity does not match this Scout");
  });

  it("does not invent an account for a different product", async () => {
    const { backend, userId } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    await insertManagedAccount(backend, {
      scoutId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "conrad-scout",
    });
    const productId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("products", {
          name: "Samebase",
          domain: "samebase.com",
          primaryUrl: "https://samebase.com",
        }),
    );
    const observedUrl = "https://dashboard.convex.dev/t/conrad-5bce5";
    const context = await insertTaskBrowserEvidence(backend, {
      userId,
      scoutId,
      productId,
      observedUrl,
    });

    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticatedFromTask, {
        promptMessageId: context.promptMessageId,
        accountAccess: "created",
        observedUrl,
        visibleIdentity: "conrad@agentmail.to",
        visibleSessionControl: "Log out",
        loginMethod: {
          kind: "oauth",
          providerServiceDomain: "github.com",
          providerIdentifier: "conrad-scout",
        },
      }),
    ).rejects.toThrow("No Scout service account is registered for the observed product");
  });

  it("rejects a fifty-first account before it can disappear from a Scout list", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    await backend.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1) {
        const productId = await ctx.db.insert("products", {
          name: `Service ${index}`,
          domain: `service-${index}.example`,
          primaryUrl: `https://service-${index}.example`,
        });
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId,
          productId,
          serviceName: `Service ${index}`,
          serviceDomain: `service-${index}.example`,
          identifier: `account-${index}`,
          authenticationEvidence: { kind: "none" },
          loginMethod: {
            kind: "managed_password",
            credentialHost: `service-${index}.example`,
            createdAt: 1,
          },
        });
      }
    });

    await expect(admin.query(serviceAccountsApi["list"], { scoutId })).resolves.toHaveLength(50);
    await expect(
      admin.mutation(serviceAccountsApi["registerOauth"], {
        scoutId,
        serviceName: "Hidden service",
        serviceDomain: "hidden.example",
        identifier: "hidden-account",
        providerAccountId: (await admin.query(serviceAccountsApi["list"], { scoutId }))[0]._id,
      }),
    ).rejects.toThrow("A Scout can have at most 50 service accounts");
  });

  it("rejects a two-hundred-and-first account before it can disappear from the global list", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutIds = await Promise.all(
      Array.from({ length: 5 }, (_, index) => insertScout(backend, `scout-${index}`)),
    );
    await backend.run(async (ctx) => {
      for (let index = 0; index < 200; index += 1) {
        const productId = await ctx.db.insert("products", {
          name: `Service ${index}`,
          domain: `service-${index}.example`,
          primaryUrl: `https://service-${index}.example`,
        });
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId: scoutIds[Math.floor(index / 40)],
          productId,
          serviceName: `Service ${index}`,
          serviceDomain: `service-${index}.example`,
          identifier: `account-${index}`,
          authenticationEvidence: { kind: "none" },
          loginMethod: {
            kind: "managed_password",
            credentialHost: `service-${index}.example`,
            createdAt: 1,
          },
        });
      }
    });

    await expect(admin.query(serviceAccountsApi["list"], {})).resolves.toHaveLength(200);
    await expect(
      admin.mutation(serviceAccountsApi["registerOauth"], {
        scoutId: scoutIds[4],
        serviceName: "Hidden service",
        serviceDomain: "hidden.example",
        identifier: "hidden-account",
        providerAccountId: (
          await admin.query(serviceAccountsApi["list"], { scoutId: scoutIds[4] })
        )[0]._id,
      }),
    ).rejects.toThrow("Service account inventory can contain at most 200 accounts");
  });
});
