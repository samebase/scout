/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import schema from "../schema";
import { decryptRuntimeManagedPassword } from "../scout/accountTools";
import { createBrowserHarness } from "../scout/browserTools";
import type { PlaywrightBrowser } from "../scout/playwrightBrowser";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { createAgentsAccountTools } from "./accounts";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};
const key = Buffer.alloc(32, 7).toString("base64");
const observedUrl = "https://accounts.example.com/signup";
const options = { toolCallId: "account-tool", messages: [], context: {} };
const passwordTarget = { kind: "label", text: "Password", exact: true } as const;
const account = {
  serviceName: "Example",
  serviceDomain: "example.com",
  identifier: "scout@example.test",
};

beforeEach(() => vi.stubEnv("SCOUT_CREDENTIAL_MASTER_KEY_V1", key));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const backend = convexTest(schema, modules);
  const seeded = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      slug: "scout",
      status: "active",
      agentMail: { inboxId: "scout", address: account.identifier },
      firecrawl: { profileName: "scout-profile" },
    });
    const scout = await ctx.db.get("scouts", scoutId);
    if (!scout) throw new Error("Scout fixture missing");
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      userId,
      scoutId,
      scoutName: scout.displayName,
      title: "Signup",
      model: "test",
      active: true,
      state: { kind: "running" },
      nextSequence: 1,
      usage: null,
      browser: {
        providerSessionId: "browser-1",
        cdpUrl: "wss://browser.example.test/cdp",
        interactiveLiveViewUrl: null,
        liveViewUrl: null,
        currentUrl: observedUrl,
      },
    });
    return { userId, scout, sessionId };
  });
  const runtime = {
    captureScreenshot: vi.fn<PlaywrightBrowser["captureScreenshot"]>(),
    disconnect: vi.fn(async () => undefined),
    startClickCapture: vi.fn(async () => undefined),
    finishClickCapture: vi.fn<PlaywrightBrowser["finishClickCapture"]>(async () => ({
      kind: "unavailable",
    })),
    selectTab: vi.fn(async () => true),
    selectedTabId: vi.fn(async () => "tab-1"),
    snapshot: vi.fn(async () => '- textbox "Password"'),
    navigate: vi.fn(async () => undefined),
    getPage: vi.fn(async () => observedUrl),
    getElement: vi.fn(async () => ""),
    getElementAttribute: vi.fn(async () => "password"),
    fill: vi.fn(async () => undefined),
    observe: vi.fn(async () => ({
      capturedAtMs: 2,
      tabs: [{ tabId: "tab-1", title: "Signup", url: observedUrl, active: true }],
    })),
  } satisfies PlaywrightBrowser;
  const browser = createBrowserHarness(
    {},
    {
      browser: async () => ({
        success: true,
        id: "browser-1",
        cdpUrl: "wss://browser.example.test/cdp",
      }),
      browserExecute: async () => ({ success: true, stdout: "", exitCode: 0, killed: false }),
      deleteBrowser: async () => ({ success: true }),
      connect: async () => runtime,
      now: () => 2,
      sleep: async () => undefined,
    },
  );
  await browser.attach(
    {
      providerSessionId: "browser-1",
      cdpUrl: "wss://browser.example.test/cdp",
      interactiveLiveViewUrl: null,
    },
    { captureOperations: false },
  );
  const tools = (ctx: ActionCtx) => createAgentsAccountTools(ctx, { ...seeded, browser });
  const request = {
    kind: "agents_api",
    sessionId: seeded.sessionId,
    scoutId: seeded.scout._id,
    observedUrl,
    ...account,
  } as const;
  return { backend, ...seeded, runtime, browser, tools, request };
}

it.each([observedUrl, null, "https://accounts.example.com/previous"])(
  "uses the live page to prepare, fill, record and reuse passwords when persisted currentUrl is %s",
  async (currentUrl) => {
    const { backend, tools, scout, runtime, browser, sessionId } = await setup();
    await backend.run(async (ctx) => {
      const session = await ctx.db.get("agentsApiSessions", sessionId);
      if (!session?.browser) throw new Error("Missing browser fixture");
      await ctx.db.patch("agentsApiSessions", sessionId, {
        browser: { ...session.browser, currentUrl },
      });
    });
    await backend.action(async (ctx) => {
      const accountTools = tools(ctx);
      const prepared = await accountTools.prepare_account_password.execute(account, options);
      const [credential] = await ctx.runQuery(
        internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout,
        { scoutId: scout._id },
      );
      if (!credential) throw new Error("Missing encrypted password");
      const password = decryptRuntimeManagedPassword(credential, scout._id, key);
      expect(JSON.stringify(prepared)).not.toContain(password);
      expect(JSON.stringify(prepared)).not.toContain(credential.ciphertext);
      await expect(
        accountTools.fill_account_password.execute({ passwordTarget }, options),
      ).resolves.toEqual({ filledFields: 1 });
      expect(runtime.fill).toHaveBeenCalledWith(passwordTarget, password, undefined);
      runtime.snapshot.mockResolvedValue(`Password: ${password}`);
      expect((await browser.actions.snapshot()).output).toBe("Password: [secret redacted]");
      const evidence = {
        accountAccess: "created",
        identifier: account.identifier,
        loginMethod: { kind: "managed_password" },
      } as const;
      runtime.getPage.mockResolvedValue("https://example.com/dashboard?from=signup#account");
      runtime.snapshot.mockClear();
      const recorded = await accountTools.record_authenticated_service_account.execute(
        evidence,
        options,
      );
      expect(recorded).toEqual({ serviceAccountId: credential.serviceAccountId, created: false });
      expect(runtime.snapshot).not.toHaveBeenCalled();
      runtime.getPage.mockResolvedValue(observedUrl);
      expect(await accountTools.prepare_account_password.execute(account, options)).toEqual(
        prepared,
      );
      await expect(
        accountTools.record_authenticated_service_account.execute(
          { ...evidence, identifier: "another-user" },
          options,
        ),
      ).rejects.toThrow("matching managed-password");
      await backend.run(async (dbCtx) => {
        const saved = await dbCtx.db.get("scoutServiceAccounts", credential.serviceAccountId);
        expect(saved?.authenticationEvidence.kind).toBe("succeeded");
        expect(saved?.lastObserved).toBeUndefined();
        expect(await dbCtx.db.query("scoutChats").take(1)).toEqual([]);
        expect(await dbCtx.db.query("scoutBrowserSessions").take(1)).toEqual([]);
        expect(await dbCtx.db.query("scoutTurns").take(1)).toEqual([]);
      });
    });
  },
);

it.each([
  ["http://accounts.example.com/signup", "HTTPS"],
  ["https://accounts.example.com:8443/signup", "HTTPS"],
  ["https://accounts.example.com.attacker.test/signup", "must belong"],
])("rejects an unsafe or out-of-scope live signup URL %s", async (url, message) => {
  const { backend, tools, runtime } = await setup();
  runtime.getPage.mockResolvedValue(url);
  await expect(
    backend.action(async (ctx) => tools(ctx).prepare_account_password.execute(account, options)),
  ).rejects.toThrow(message);
});

it("rejects URL credentials at the registration boundary", async () => {
  const { backend, request } = await setup();
  await expect(
    backend.query(internal.scout.serviceAccountCredentials.prepareManagedRegistration, {
      request: { ...request, observedUrl: "https://username:password@accounts.example.com/signup" },
    }),
  ).rejects.toThrow("HTTPS");
});

it("rejects filling on another host and recording a password account on another service", async () => {
  const { backend, tools, runtime } = await setup();
  await backend.action(async (ctx) => {
    const accountTools = tools(ctx);
    await accountTools.prepare_account_password.execute(account, options);
    runtime.getPage.mockResolvedValue("https://example.com/login");
    await expect(
      accountTools.fill_account_password.execute({ passwordTarget }, options),
    ).rejects.toThrow("exactly one managed password");
    runtime.getPage
      .mockResolvedValueOnce(observedUrl)
      .mockResolvedValueOnce("https://example.com/login");
    await expect(
      accountTools.fill_account_password.execute({ passwordTarget }, options),
    ).rejects.toThrow("exact configured login host");
    runtime.getPage.mockResolvedValue("https://accounts.example.com.attacker.test/account");
    await expect(
      accountTools.record_authenticated_service_account.execute(
        {
          accountAccess: "created",
          identifier: account.identifier,
          loginMethod: { kind: "managed_password" },
        },
        options,
      ),
    ).rejects.toThrow("matching managed-password");
    expect(runtime.fill).not.toHaveBeenCalled();
  });
});

it("requires both a registered browser and a successful live provider read", async () => {
  const { backend, tools, browser, sessionId } = await setup();
  await backend.run(async (ctx) => ctx.db.patch("agentsApiSessions", sessionId, { browser: null }));
  await expect(
    backend.action(async (ctx) => tools(ctx).prepare_account_password.execute(account, options)),
  ).rejects.toThrow("Running Agents API browser session");
  await browser.close();
  await expect(
    backend.action(async (ctx) => tools(ctx).prepare_account_password.execute(account, options)),
  ).rejects.toThrow("Open a browser session");
});

it("checks the session owner again after permission is revoked", async () => {
  const { backend, tools, userId, request } = await setup();
  await backend.action(async (ctx) =>
    tools(ctx).prepare_account_password.execute(account, options),
  );
  await backend.run(async (ctx) => ctx.db.patch("users", userId, { email: "member@example.test" }));
  await expect(
    backend.query(internal.scout.serviceAccountCredentials.prepareManagedRegistration, { request }),
  ).rejects.toThrow("Not authorized");
  await expect(
    backend.action(async (ctx) =>
      tools(ctx).fill_account_password.execute({ passwordTarget }, options),
    ),
  ).rejects.toThrow("Not authorized");
  await expect(
    backend.action(async (ctx) =>
      tools(ctx).record_authenticated_service_account.execute(
        {
          accountAccess: "created",
          identifier: account.identifier,
          loginMethod: { kind: "managed_password" },
        },
        options,
      ),
    ),
  ).rejects.toThrow("Not authorized");
});

it("rejects the wrong Scout, a stopped session, foreign signup email and conflicting credential scope", async () => {
  const { backend, tools, request, sessionId } = await setup();
  const otherScout = await backend.run(async (ctx) =>
    ctx.db.insert("scouts", {
      displayName: "Other",
      websiteIdentity: { firstName: "Other", lastName: "Scout" },
      slug: "other",
      status: "active",
      agentMail: { inboxId: "other", address: "other@example.test" },
      firecrawl: { profileName: "other" },
    }),
  );
  const prepare = (changes: Partial<typeof request>) =>
    backend.query(internal.scout.serviceAccountCredentials.prepareManagedRegistration, {
      request: { ...request, ...changes },
    });
  await expect(prepare({ scoutId: otherScout })).rejects.toThrow("does not belong");
  await expect(prepare({ identifier: "other@example.test" })).rejects.toThrow("Scout's own email");
  await expect(prepare({ serviceDomain: "attacker.test" })).rejects.toThrow("must belong");
  await backend.action(async (ctx) =>
    tools(ctx).prepare_account_password.execute(account, options),
  );
  await expect(prepare({ serviceDomain: "accounts.example.com" })).rejects.toThrow(
    "different account",
  );
  await expect(prepare({ identifier: "another-user" })).rejects.toThrow("different account");
  await backend.run(async (ctx) =>
    ctx.db.patch("agentsApiSessions", sessionId, { state: { kind: "stopped" } }),
  );
  await expect(prepare({})).rejects.toThrow("Running Agents API browser session");
});

it("never fills text inputs, including a non-password confirmation field", async () => {
  const { backend, tools, runtime } = await setup();
  await backend.action(async (ctx) => {
    const accountTools = tools(ctx);
    await accountTools.prepare_account_password.execute(account, options);
    runtime.getElementAttribute.mockResolvedValue("text");
    await expect(
      accountTools.fill_account_password.execute({ passwordTarget }, options),
    ).rejects.toThrow("password inputs");
    runtime.getElementAttribute.mockResolvedValueOnce("password").mockResolvedValueOnce("text");
    await expect(
      accountTools.fill_account_password.execute(
        {
          passwordTarget,
          passwordConfirmationTarget: { kind: "label", text: "Confirm password", exact: true },
        },
        options,
      ),
    ).rejects.toThrow("password inputs");
    expect(runtime.fill).not.toHaveBeenCalled();
  });
});

it("records OAuth only through this Scout's provider account and preserves the registered method", async () => {
  const { backend, tools, scout } = await setup();
  const providerId = await backend.run(async (ctx) =>
    ctx.db.insert("scoutServiceAccounts", {
      scoutId: scout._id,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "scout-provider",
      loginMethod: { kind: "managed_password", credentialHost: "github.com", createdAt: 1 },
      authenticationEvidence: { kind: "none" },
    }),
  );
  await backend.action(async (ctx) => {
    const record = tools(ctx).record_authenticated_service_account;
    const evidence = {
      accountAccess: "created",
      identifier: account.identifier,
      loginMethod: {
        kind: "oauth",
        providerServiceDomain: "github.com",
        providerIdentifier: "scout-provider",
      },
    } as const;
    await expect(
      record.execute({ ...evidence, identifier: "foreign@example.test" }, options),
    ).rejects.toThrow("does not belong");
    const saved = await record.execute(evidence, options);
    expect(saved).toMatchObject({ created: true });
    expect(await record.execute(evidence, options)).toEqual({ ...saved, created: false });
    await backend.run(async (dbCtx) => {
      const stored = await dbCtx.db.get("scoutServiceAccounts", providerId);
      if (!stored) throw new Error("Missing provider");
      const otherScoutId = await dbCtx.db.insert("scouts", {
        displayName: "Other",
        websiteIdentity: { firstName: "Other", lastName: "Scout" },
        slug: "other",
        status: "active",
        agentMail: { inboxId: "other", address: "other@example.test" },
        firecrawl: { profileName: "other" },
      });
      await dbCtx.db.patch("scoutServiceAccounts", providerId, { scoutId: otherScoutId });
    });
    await expect(record.execute(evidence, options)).rejects.toThrow("not registered to this Scout");
  });
});
