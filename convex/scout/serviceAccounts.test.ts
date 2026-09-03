import type { FunctionArgs } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
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
        agentMail: { inboxId: `${slug}-inbox`, address: `${slug}@example.test` },
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
  return await backend.run(
    async (ctx) =>
      await ctx.db.insert("scoutServiceAccounts", {
        ...args,
        authenticationEvidence: { kind: "none" },
        loginMethod: {
          kind: "managed_password",
          credentialHost: args.serviceDomain,
          createdAt: 1,
        },
      }),
  );
}

async function authenticatedBackend() {
  const backend = testBackend();
  const userId = await insertUser(backend, ADMIN_EMAIL);
  return {
    backend,
    admin: backend.withIdentity({ subject: `${userId}|test-session` }),
    userId,
  };
}

async function accountContext() {
  const authenticated = await authenticatedBackend();
  const { backend, userId } = authenticated;
  const scoutId = await insertScout(backend, "conrad");
  const providerAccountId = await insertManagedAccount(backend, {
    scoutId,
    serviceName: "GitHub",
    serviceDomain: "github.com",
    identifier: "conrad-scout",
  });
  const observedUrl = "https://dashboard.example.com/account";
  const browser = await backend.run(async (ctx) => {
    const threadId = crypto.randomUUID();
    const chatId = await ctx.db.insert("scoutChats", {
      threadId,
      userId,
      scoutId,
      createdAt: 1,
    });
    const sessionId = await ctx.db.insert("scoutBrowserSessions", {
      threadId,
      scoutId,
      sequence: 1,
      provider: "firecrawl",
      providerSessionId: "provider-session",
      profileName: "conrad-profile",
      viewport: { width: 1_280, height: 800 },
      nextOperationSequence: 2,
      lifecycle: { kind: "active", openedAtMs: 1 },
    });
    const operationId = await ctx.db.insert("scoutBrowserOperations", {
      sessionId,
      sequence: 1,
      toolCallId: "browser-open",
      action: { kind: "open", url: observedUrl },
      state: {
        kind: "applied",
        settledAtMs: 3,
        telemetry: {
          version: 1,
          before: { capturedAtMs: 1, tabs: [] },
          dispatchedAtMs: 2,
          returnedAtMs: 3,
          after: {
            capturedAtMs: 3,
            tabs: [
              { tabId: "tab-1", title: "Authenticated service", url: observedUrl, active: true },
            ],
          },
        },
      },
    });
    return { chatId, threadId, sessionId, operationId };
  });
  const evidence = {
    sessionId: browser.sessionId,
    accountAccess: "created",
    observedUrl,
    visibleIdentity: "Account\nconrad@example.test",
    visibleSessionControl: "Log out",
    loginMethod: {
      kind: "oauth",
      providerServiceDomain: "github.com",
      providerIdentifier: "conrad-scout",
    },
  } satisfies FunctionArgs<typeof internal.scout.serviceAccounts.recordAuthenticated>;
  return { ...authenticated, scoutId, providerAccountId, ...browser, evidence };
}

async function fillInventory(
  backend: ReturnType<typeof testBackend>,
  scoutId: Id<"scouts">,
  count: number,
) {
  await backend.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      await ctx.db.insert("scoutServiceAccounts", {
        scoutId,
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
}

describe("Scout service-account inventory", () => {
  it("rejects unauthenticated and non-admin inventory access", async () => {
    const backend = testBackend();
    await expect(backend.query(api.scout.serviceAccounts.list, {})).rejects.toThrow(
      "Not authorized",
    );
    const nonAdminId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(nonAdmin.query(api.scout.serviceAccounts.list, {})).rejects.toThrow(
      "Not authorized",
    );
  });

  it("filters accounts by Scout and projects an empty observation", async () => {
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
    const conradAccounts = await admin.query(api.scout.serviceAccounts.list, { scoutId: conradId });
    expect(conradAccounts).toHaveLength(1);
    expect(conradAccounts[0]).toMatchObject({
      scoutId: conradId,
      serviceName: "Tally",
      lastObserved: null,
    });
    const allAccounts = await admin.query(api.scout.serviceAccounts.list, {});
    expect(allAccounts).toHaveLength(2);
    expect(new Set(allAccounts.map((account) => account.scoutId))).toEqual(
      new Set([conradId, adaId]),
    );
  });

  it("creates and verifies an OAuth account on the observed service without a catalog", async () => {
    const { backend, admin, scoutId, providerAccountId, threadId, sessionId, evidence } =
      await accountContext();
    const providerBefore = await backend.run(
      async (ctx) => await ctx.db.get("scoutServiceAccounts", providerAccountId),
    );
    const result = await backend.mutation(
      internal.scout.serviceAccounts.recordAuthenticated,
      evidence,
    );
    expect(result).toEqual({ serviceAccountId: expect.any(String), created: true });
    await expect(admin.query(api.scout.serviceAccounts.list, { scoutId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: result.serviceAccountId,
          scoutId,
          serviceName: "dashboard.example.com",
          serviceDomain: "dashboard.example.com",
          identifier: "conrad@example.test",
          authenticationEvidence: { kind: "succeeded", checkedAt: expect.any(Number) },
          loginMethod: { kind: "oauth", providerAccountId },
          lastObserved: {
            threadId,
            sessionId,
            recordedAt: expect.any(Number),
            observedUrl: evidence.observedUrl,
            visibleIdentity: evidence.visibleIdentity,
            visibleSessionControl: evidence.visibleSessionControl,
            accountAccess: "created",
          },
        }),
      ]),
    );
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, {
        ...evidence,
        accountAccess: "recovered",
      }),
    ).resolves.toEqual({ serviceAccountId: result.serviceAccountId, created: false });
    const stored = await backend.run(
      async (ctx) => await ctx.db.get("scoutServiceAccounts", result.serviceAccountId),
    );
    expect(stored).toMatchObject({
      loginMethod: { kind: "oauth", providerAccountId },
      lastObserved: { accountAccess: "recovered" },
    });
    expect(
      await backend.run(async (ctx) => await ctx.db.get("scoutServiceAccounts", providerAccountId)),
    ).toEqual(providerBefore);
    await expect(admin.query(api.scout.serviceAccounts.list, { scoutId })).resolves.toHaveLength(2);
  });

  it("updates a connected service without changing its managed credential binding", async () => {
    const { backend, scoutId, threadId, evidence } = await accountContext();
    const serviceAccountId = await insertManagedAccount(backend, {
      scoutId,
      serviceName: "Example",
      serviceDomain: "example.com",
      identifier: "conrad@example.test",
    });
    const before = await backend.run(
      async (ctx) => await ctx.db.get("scoutServiceAccounts", serviceAccountId),
    );
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, {
        ...evidence,
        accountAccess: "recovered",
        loginMethod: { kind: "managed_password" },
      }),
    ).resolves.toEqual({ serviceAccountId, created: false });
    const after = await backend.run(
      async (ctx) => await ctx.db.get("scoutServiceAccounts", serviceAccountId),
    );
    expect(after).toEqual({
      ...before,
      authenticationEvidence: { kind: "succeeded", checkedAt: expect.any(Number) },
      lastObserved: {
        threadId,
        sessionId: evidence.sessionId,
        recordedAt: expect.any(Number),
        observedUrl: evidence.observedUrl,
        visibleIdentity: evidence.visibleIdentity,
        visibleSessionControl: evidence.visibleSessionControl,
        accountAccess: "recovered",
      },
    });
  });

  it("requires an exact OAuth provider account belonging to the session's Scout", async () => {
    const { backend, evidence } = await accountContext();
    const otherScoutId = await insertScout(backend, "ada");
    await insertManagedAccount(backend, {
      scoutId: otherScoutId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "ada-scout",
    });
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, {
        ...evidence,
        loginMethod: { ...evidence.loginMethod, providerIdentifier: "ada-scout" },
      }),
    ).rejects.toThrow("OAuth provider account is not registered to this Scout");
  });

  it.each(["missing", "different Scout"])("rejects a chat binding that is %s", async (binding) => {
    const { backend, chatId, evidence } = await accountContext();
    const otherScoutId = await insertScout(backend, "ada");
    await backend.run(async (ctx) => {
      if (binding === "missing") await ctx.db.delete("scoutChats", chatId);
      else await ctx.db.patch("scoutChats", chatId, { scoutId: otherScoutId });
    });
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, evidence),
    ).rejects.toThrow("Browser session does not match its Scout chat");
  });

  it("rejects a closed browser session", async () => {
    const { backend, sessionId, evidence } = await accountContext();
    await backend.run(async (ctx) => {
      await ctx.db.patch("scoutBrowserSessions", sessionId, {
        lifecycle: {
          kind: "closed",
          openedAtMs: 1,
          closedAtMs: 4,
          providerDurationMs: null,
          creditsBilled: null,
        },
      });
    });
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, evidence),
    ).rejects.toThrow("Active Scout browser session not found");
  });

  it.each([
    { kind: "prepared", preparedAtMs: 4 },
    { kind: "failed_before_dispatch", settledAtMs: 4, failure: "Failed" },
    { kind: "indeterminate_after_dispatch", settledAtMs: 4, failure: "Unknown outcome" },
  ] satisfies Array<Doc<"scoutBrowserOperations">["state"]>)(
    "rejects an account observation after a $kind browser operation",
    async (state) => {
      const { backend, operationId, evidence } = await accountContext();
      await backend.run(async (ctx) => {
        await ctx.db.patch("scoutBrowserOperations", operationId, { state });
      });
      await expect(
        backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, evidence),
      ).rejects.toThrow("A successful service-page observation is required");
    },
  );

  it("requires the account evidence to come from the latest observed page", async () => {
    const { backend, evidence } = await accountContext();
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, {
        ...evidence,
        observedUrl: "https://another.example/account",
      }),
    ).rejects.toThrow("The authenticated account evidence is not from the latest service page");
  });

  it.each([
    {
      visibleIdentity: "Team Settings\nconrad's team",
      visibleSessionControl: "Log out",
      error: "Visible account identity does not match this Scout",
    },
    {
      visibleIdentity: "other@example.test",
      visibleSessionControl: "Log out",
      error: "Visible account identity does not match this Scout",
    },
    {
      visibleIdentity: "conrad@example.test",
      visibleSessionControl: "Settings",
      error: "The visible account menu does not expose a Sign out or Log out control",
    },
  ])(
    "rejects unsupported account evidence: $visibleIdentity / $visibleSessionControl",
    async (input) => {
      const { backend, evidence } = await accountContext();
      await expect(
        backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, {
          ...evidence,
          visibleIdentity: input.visibleIdentity,
          visibleSessionControl: input.visibleSessionControl,
        }),
      ).rejects.toThrow(input.error);
    },
  );

  it("does not create a managed-password account from browser evidence", async () => {
    const { backend, evidence } = await accountContext();
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, {
        ...evidence,
        loginMethod: { kind: "managed_password" },
      }),
    ).rejects.toThrow("A managed-password account must be registered before it is used");
  });

  it("does not replace an existing OAuth provider link", async () => {
    const { backend, scoutId, providerAccountId, evidence } = await accountContext();
    const serviceAccountId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId,
          serviceName: "Example",
          serviceDomain: "example.com",
          identifier: "conrad@example.test",
          authenticationEvidence: { kind: "none" },
          loginMethod: { kind: "oauth", providerAccountId },
        }),
    );
    await insertManagedAccount(backend, {
      scoutId,
      serviceName: "GitLab",
      serviceDomain: "gitlab.com",
      identifier: "conrad-lab",
    });
    const before = await backend.run(
      async (ctx) => await ctx.db.get("scoutServiceAccounts", serviceAccountId),
    );
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, {
        ...evidence,
        loginMethod: {
          kind: "oauth",
          providerServiceDomain: "gitlab.com",
          providerIdentifier: "conrad-lab",
        },
      }),
    ).rejects.toThrow("Observed login method does not match the registered service account");
    expect(
      await backend.run(async (ctx) => await ctx.db.get("scoutServiceAccounts", serviceAccountId)),
    ).toEqual(before);
  });

  it("rejects a fifty-first account before it can disappear from a Scout list", async () => {
    const { backend, admin, scoutId, evidence } = await accountContext();
    await fillInventory(backend, scoutId, 49);
    await expect(admin.query(api.scout.serviceAccounts.list, { scoutId })).resolves.toHaveLength(
      50,
    );
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, evidence),
    ).rejects.toThrow("A Scout can have at most 50 service accounts");
  });

  it("rejects a two-hundred-and-first account before it can disappear from the global list", async () => {
    const { backend, admin, scoutId, evidence } = await accountContext();
    await fillInventory(backend, scoutId, 39);
    for (let index = 0; index < 4; index += 1) {
      const otherScoutId = await insertScout(backend, `scout-${index}`);
      await fillInventory(backend, otherScoutId, 40);
    }
    await expect(admin.query(api.scout.serviceAccounts.list, {})).resolves.toHaveLength(200);
    await expect(
      backend.mutation(internal.scout.serviceAccounts.recordAuthenticated, evidence),
    ).rejects.toThrow("Service account inventory can contain at most 200 accounts");
  });
});
