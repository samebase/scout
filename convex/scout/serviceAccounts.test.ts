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
  it("rejects unauthenticated and non-admin inventory access", async () => {
    const backend = testBackend();
    await expect(backend.query(serviceAccountsApi["list"], {})).rejects.toThrow("Not authorized");

    const nonAdminId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(nonAdmin.query(serviceAccountsApi["list"], {})).rejects.toThrow("Not authorized");
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
    const { backend, admin, userId } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    await backend.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1) {
        const isProvider = index === 0;
        const serviceName = isProvider ? "GitHub" : `Service ${index}`;
        const serviceDomain = isProvider ? "github.com" : `service-${index}.example`;
        const identifier = isProvider ? "conrad-scout" : `account-${index}`;
        const productId = await ctx.db.insert("products", {
          name: serviceName,
          domain: serviceDomain,
          primaryUrl: `https://${serviceDomain}`,
        });
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId,
          productId,
          serviceName,
          serviceDomain,
          identifier,
          authenticationEvidence: { kind: "none" },
          loginMethod: {
            kind: "managed_password",
            credentialHost: serviceDomain,
            createdAt: 1,
          },
        });
      }
    });

    await expect(admin.query(serviceAccountsApi["list"], { scoutId })).resolves.toHaveLength(50);
    const productId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("products", {
          name: "Hidden service",
          domain: "hidden.example",
          primaryUrl: "https://hidden.example",
        }),
    );
    const observedUrl = "https://hidden.example/account";
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
        visibleIdentity: "Account\nconrad@example.test",
        visibleSessionControl: "Log out",
        loginMethod: {
          kind: "oauth",
          providerServiceDomain: "github.com",
          providerIdentifier: "conrad-scout",
        },
      }),
    ).rejects.toThrow("A Scout can have at most 50 service accounts");
  });

  it("rejects a two-hundred-and-first account before it can disappear from the global list", async () => {
    const { backend, admin, userId } = await authenticatedBackend();
    const scoutIds = await Promise.all(
      Array.from({ length: 5 }, (_, index) => insertScout(backend, `scout-${index}`)),
    );
    await backend.run(async (ctx) => {
      for (let index = 0; index < 200; index += 1) {
        const isProvider = index === 160;
        const serviceName = isProvider ? "GitHub" : `Service ${index}`;
        const serviceDomain = isProvider ? "github.com" : `service-${index}.example`;
        const identifier = isProvider ? "scout-4-provider" : `account-${index}`;
        const productId = await ctx.db.insert("products", {
          name: serviceName,
          domain: serviceDomain,
          primaryUrl: `https://${serviceDomain}`,
        });
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId: scoutIds[Math.floor(index / 40)],
          productId,
          serviceName,
          serviceDomain,
          identifier,
          authenticationEvidence: { kind: "none" },
          loginMethod: {
            kind: "managed_password",
            credentialHost: serviceDomain,
            createdAt: 1,
          },
        });
      }
    });

    await expect(admin.query(serviceAccountsApi["list"], {})).resolves.toHaveLength(200);
    const scoutId = scoutIds[4];
    const productId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("products", {
          name: "Hidden service",
          domain: "hidden.example",
          primaryUrl: "https://hidden.example",
        }),
    );
    const observedUrl = "https://hidden.example/account";
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
        visibleIdentity: "Account\nscout-4@example.test",
        visibleSessionControl: "Log out",
        loginMethod: {
          kind: "oauth",
          providerServiceDomain: "github.com",
          providerIdentifier: "scout-4-provider",
        },
      }),
    ).rejects.toThrow("Service account inventory can contain at most 200 accounts");
  });
});
