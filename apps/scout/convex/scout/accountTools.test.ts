import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import schema from "../schema";
import {
  createAccountTools,
  decryptRuntimeManagedPassword,
  restoreManagedPasswordRedaction,
} from "./accountTools";
import { createBrowserHarness } from "./browserTools";
import type { PlaywrightBrowser } from "./playwrightBrowser";
import { prepareManagedPassword } from "./serviceAccountCredentialActions";

const modules = {
  ...import.meta.glob("../**/*.*s"),
  ...Object.fromEntries(
    Object.entries(
      import.meta.glob([
        "./serviceAccountCredentials.ts",
        "./serviceAccounts.ts",
        "./serviceAccountCredentialActions.ts",
      ]),
    ).map(([path, module]) => [`../scout/${path.slice(2)}`, module]),
  ),
};
const key = Buffer.alloc(32, 7).toString("base64");
const toolOptions = {
  toolCallId: "account-tool",
  messages: [],
  context: {},
  abortSignal: new AbortController().signal,
};
const passwordTarget = { kind: "label", text: "Password", exact: true } as const;

beforeEach(() => vi.stubEnv("SCOUT_CREDENTIAL_MASTER_KEY_V1", key));
afterEach(() => vi.unstubAllEnvs());

async function browserAccountContext() {
  const backend = convexTest(schema, modules);
  const seeded = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, {
      email: ADMIN_EMAIL,
    });
    const scoutIds = [];
    for (const name of ["conrad", "magda"]) {
      scoutIds.push(
        await ctx.db.insert("scouts", {
          displayName: name,
          websiteIdentity: { firstName: name, lastName: "Scout" },
          slug: name,
          status: "active",
          agentMail: { inboxId: name, address: `${name}@example.test` },
          firecrawl: { profileName: `scout-${name}` },
        }),
      );
    }
    const [conradId, scoutId] = scoutIds;
    if (!conradId || !scoutId) throw new Error("Missing test scouts");
    const threadId = "magda-thread";
    const chatId = await ctx.db.insert("scoutChats", {
      purpose: { kind: "general" },
      visibility: "private",
      threadId,
      userId,
      scoutId,
      createdAt: 1,
    });
    const sessionId = await ctx.db.insert("scoutBrowserSessions", {
      scoutId,
      threadId,
      sequence: 1,
      provider: "firecrawl",
      providerSessionId: "browser-1",
      profileName: "scout-magda",
      viewport: { width: 1280, height: 800 },
      nextOperationSequence: 2,
      lifecycle: {
        kind: "active",
        openedAtMs: 1,
        providerExpiresAtMs: 3600000,
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=test",
        interactiveLiveViewUrl: null,
      },
    });
    const operationId = await ctx.db.insert("scoutBrowserOperations", {
      sessionId,
      sequence: 1,
      toolCallId: "open",
      action: { kind: "open", url: "https://accounts.example.com/signup" },
      state: {
        kind: "applied",
        settledAtMs: 2,
        telemetry: {
          version: 1,
          before: { capturedAtMs: 1, tabs: [] },
          dispatchedAtMs: 1,
          returnedAtMs: 2,
          after: {
            capturedAtMs: 2,
            tabs: [
              {
                tabId: "tab-1",
                title: "Signup",
                url: "https://accounts.example.com/signup",
                active: true,
              },
            ],
          },
        },
      },
    });
    return { scoutId, conradId, sessionId, chatId, operationId };
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
    getPage: vi.fn(async () => "https://accounts.example.com/signup?source=home#form"),
    getElement: vi.fn(async (target: Parameters<PlaywrightBrowser["getElement"]>[0]) =>
      target.kind === "text" ? target.text : "",
    ),
    getElementAttribute: vi.fn(async () => "password"),
    fill: vi.fn(async () => undefined),
    observe: vi.fn(async () => ({
      capturedAtMs: 2,
      tabs: [
        {
          tabId: "tab-1",
          title: "Signup",
          url: "https://accounts.example.com/signup",
          active: true,
        },
      ],
    })),
  } satisfies PlaywrightBrowser;
  const browserDependencies = {
    browser: async () => ({
      success: true,
      id: "browser-1",
      cdpUrl: "wss://browser.firecrawl.dev/cdp?token=test",
    }),
    browserExecute: vi.fn(async () => ({ success: true, stdout: "", exitCode: 0, killed: false })),
    deleteBrowser: async () => ({ success: true }),
    connect: async () => runtime,
    now: () => 2,
    sleep: async () => undefined,
  } satisfies Parameters<typeof createBrowserHarness>[1];
  const browser = createBrowserHarness({}, browserDependencies);
  await browser.open("https://accounts.example.com/signup");
  const accountTools = (ctx: Pick<ActionCtx, "runQuery" | "runMutation">) =>
    createAccountTools(ctx, {
      browser,
      scoutId: seeded.scoutId,
      sessionId: () => seeded.sessionId,
    });
  const request = {
    kind: "browser",
    sessionId: seeded.sessionId,
    observedUrl: "https://accounts.example.com/signup?source=home#form",
    serviceName: "Example",
    serviceDomain: "example.com",
    identifier: "magda@example.test",
  } as const;
  const credentials = async (scoutId: Id<"scouts"> = seeded.scoutId) =>
    await backend.query(internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout, {
      scoutId,
    });
  return { backend, accountTools, browserDependencies, runtime, request, credentials, ...seeded };
}

describe("Autonomous managed-password preparation", () => {
  it("redacts persisted credentials after a new controller resumes a filled browser", async () => {
    const { backend, accountTools, browserDependencies, runtime, credentials, scoutId } =
      await browserAccountContext();
    await backend.action(async (ctx) => {
      const tools = accountTools(ctx);
      await tools.prepare_account_password.execute(
        { serviceName: "Example", serviceDomain: "example.com", identifier: "magda@example.test" },
        toolOptions,
      );
      await tools.fill_account_password.execute({ passwordTarget }, toolOptions);
    });
    const saved = await credentials();
    const [credential] = saved;
    if (!credential) throw new Error("Password was not persisted");
    const password = decryptRuntimeManagedPassword(credential, scoutId, key);
    runtime.snapshot.mockResolvedValue(`- textbox "Password" [active]: ${password}`);
    browserDependencies.browserExecute.mockResolvedValue({
      success: false,
      stdout: password,
      exitCode: 1,
      killed: false,
    });
    const resumedBrowser = createBrowserHarness({}, browserDependencies);
    restoreManagedPasswordRedaction({ browser: resumedBrowser, credentials: saved, scoutId });
    await resumedBrowser.attach(
      {
        providerSessionId: "browser-1",
        cdpUrl: "wss://browser.firecrawl.dev/cdp?token=test",
        interactiveLiveViewUrl: null,
      },
      { captureOperations: false },
    );
    expect(await resumedBrowser.actions.snapshot()).toMatchObject({
      output: '- textbox "Password" [active]: [secret redacted]',
    });
    const result = await resumedBrowser.actions.executeCode("throw new Error('click failed')");
    expect(result.success).toBe(false);
    expect(result.currentPage).toContain("[secret redacted]");
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it.each([
    '- heading "MagdaPlayer"\n- button "Log Out"',
    '- heading "Account settings"\n- paragraph: m****@e******.test\n- button "Log Out on All Devices"',
    '- heading "Welcome, MagdaPlayer"\n- link "Start playing"',
  ])("prepares, records, and reuses a password with page contents: %s", async (page) => {
    const { accountTools, runtime, credentials, backend, scoutId, conradId } =
      await browserAccountContext();
    await backend.action(async (ctx) => {
      const tools = accountTools(ctx);
      await expect(credentials()).resolves.toEqual([]);
      const prepared = await tools.prepare_account_password.execute(
        { serviceName: "Example", serviceDomain: "example.com", identifier: "magda@example.test" },
        toolOptions,
      );
      expect(prepared).toEqual({
        status: "prepared",
        serviceAccountId: expect.any(String),
        credentialHost: "accounts.example.com",
      });
      const [credential] = await credentials();
      if (!credential) throw new Error("Password was not persisted");
      const password = decryptRuntimeManagedPassword(credential, scoutId, key);
      expect(password).toHaveLength(24);
      expect(JSON.stringify(prepared)).not.toContain(password);
      expect(JSON.stringify(prepared)).not.toContain(credential.ciphertext);
      await expect(credentials(conradId)).resolves.toEqual([]);
      const account = async () =>
        await backend.run(
          async (ctx) => await ctx.db.get("scoutServiceAccounts", credential.serviceAccountId),
        );
      expect(await account()).toMatchObject({ scoutId, authenticationEvidence: { kind: "none" } });
      await expect(
        tools.fill_account_password.execute({ passwordTarget }, toolOptions),
      ).resolves.toEqual({ filledFields: 1 });
      expect(runtime.fill).toHaveBeenCalledWith(passwordTarget, password, toolOptions.abortSignal);
      runtime.snapshot.mockResolvedValue(page);
      runtime.getElement.mockRejectedValue(new Error("The saved email is not visible"));
      runtime.getPage.mockClear();
      await tools.record_authenticated_service_account.execute(
        {
          accountAccess: "created",
          verification: "Account settings shows the Scout identity after completed sign-in.",
          identifier: "magda@example.test",
          loginMethod: "managed_password",
        },
        toolOptions,
      );
      expect(runtime.getPage).toHaveBeenCalledExactlyOnceWith("url", toolOptions.abortSignal);
      expect(runtime.getElement).not.toHaveBeenCalled();
      const recorded = await account();
      expect(recorded).toMatchObject({
        authenticationEvidence: { kind: "succeeded" },
        lastObserved: { accountAccess: "created" },
      });
      await expect(
        tools.prepare_account_password.execute(
          {
            serviceName: "Example",
            serviceDomain: "example.com",
            identifier: "magda@example.test",
          },
          toolOptions,
        ),
      ).resolves.toEqual(prepared);
      expect(await credentials()).toEqual([credential]);
      expect(await account()).toEqual(recorded);
      runtime.getPage.mockResolvedValue("https://other.example.com/login");
      await expect(
        tools.fill_account_password.execute({ passwordTarget }, toolOptions),
      ).rejects.toThrow("no managed password for the current login host");
      expect(runtime.fill).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the first credential when two preparations overlap", async () => {
    const { backend, request, credentials } = await browserAccountContext();
    await backend.action(async (ctx) => {
      let committed: Awaited<ReturnType<typeof prepareManagedPassword>> | null = null;
      let firstCredentials: Awaited<ReturnType<typeof credentials>> = [];
      const runMutation: ActionCtx["runMutation"] = async (mutation, ...args) => {
        committed = await prepareManagedPassword(ctx, request);
        firstCredentials = await credentials();
        return await ctx.runMutation(mutation, ...args);
      };
      const result = await prepareManagedPassword({ ...ctx, runMutation }, request);
      expect(result).toEqual(committed);
      expect(await credentials()).toEqual(firstCredentials);
      expect(firstCredentials).toHaveLength(1);
    });
  });

  it("checks password input types and the saved host for CSS targets before filling", async () => {
    const { backend, request, accountTools, runtime } = await browserAccountContext();
    const target = { kind: "css", selector: 'input[name="password"]' } as const;
    await backend.action(async (ctx) => {
      await prepareManagedPassword(ctx, request);
      const fill = accountTools(ctx).fill_account_password;
      runtime.getElementAttribute.mockResolvedValueOnce("text");
      await expect(fill.execute({ passwordTarget: target }, toolOptions)).rejects.toThrow(
        "only be filled into password inputs",
      );
      expect(runtime.fill).not.toHaveBeenCalled();

      await expect(fill.execute({ passwordTarget: target }, toolOptions)).resolves.toEqual({
        filledFields: 1,
      });
      expect(runtime.fill).toHaveBeenCalledWith(
        target,
        expect.any(String),
        toolOptions.abortSignal,
      );
      runtime.fill.mockClear();
      runtime.getPage.mockResolvedValue("https://other.example.com/login");
      await expect(fill.execute({ passwordTarget: target }, toolOptions)).rejects.toThrow(
        "no managed password for the current login host",
      );
      expect(runtime.fill).not.toHaveBeenCalled();
    });
  });

  it("reuses and fills a manually saved password whose service domain differs from its login host", async () => {
    const { backend, request, scoutId, credentials, accountTools, runtime } =
      await browserAccountContext();
    const userId = await backend.run(
      async (ctx) => await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
    );
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const result = await admin.action(api.scout.serviceAccountCredentialActions.savePassword, {
      account: {
        kind: "create",
        scoutId,
        serviceName: "Example",
        serviceDomain: "example.com",
        identifier: "magda@example.test",
      },
      credentialHost: "accounts.example.com",
      password: { kind: "provided", value: "My manually saved password" },
    });
    const before = await credentials();
    expect(await backend.action(async (ctx) => await prepareManagedPassword(ctx, request))).toEqual(
      result,
    );
    expect(await credentials()).toEqual(before);
    await backend.action(
      async (ctx) =>
        await accountTools(ctx).fill_account_password.execute({ passwordTarget }, toolOptions),
    );
    expect(runtime.fill).toHaveBeenCalledWith(
      passwordTarget,
      "My manually saved password",
      toolOptions.abortSignal,
    );
  });

  it.each([
    "http://accounts.example.com/signup",
    "https://accounts.example.com:8443/signup",
    "https://user:secret@accounts.example.com/signup",
    "https://evil.example/signup",
  ])("rejects an invalid or unobserved signup page: %s", async (observedUrl) => {
    const { backend, request, credentials } = await browserAccountContext();
    await expect(
      backend.action(async (ctx) => await prepareManagedPassword(ctx, { ...request, observedUrl })),
    ).rejects.toThrow();
    await expect(credentials()).resolves.toEqual([]);
  });

  it("rejects another scout's email and a browser attached to another scout's chat", async () => {
    const { backend, request, credentials, chatId, conradId } = await browserAccountContext();
    await expect(
      backend.action(
        async (ctx) =>
          await prepareManagedPassword(ctx, { ...request, identifier: "conrad@example.test" }),
      ),
    ).rejects.toThrow("own email address");
    await backend.run(
      async (ctx) => await ctx.db.patch("scoutChats", chatId, { scoutId: conradId }),
    );
    await expect(
      backend.action(async (ctx) => await prepareManagedPassword(ctx, request)),
    ).rejects.toThrow("does not match its Scout chat");
    await expect(credentials()).resolves.toEqual([]);
  });

  it("rechecks the browser session at commit before saving a generated password", async () => {
    const { backend, request, credentials, sessionId } = await browserAccountContext();
    await backend.action(async (ctx) => {
      const runMutation: ActionCtx["runMutation"] = async (mutation, ...args) => {
        await backend.run(async (ctx) => await ctx.db.delete("scoutBrowserSessions", sessionId));
        return await ctx.runMutation(mutation, ...args);
      };
      await expect(prepareManagedPassword({ ...ctx, runMutation }, request)).rejects.toThrow(
        "Active Scout browser session not found",
      );
    });
    await expect(credentials()).resolves.toEqual([]);
  });

  it("rejects a service domain that does not contain the observed signup host", async () => {
    const { backend, request, credentials } = await browserAccountContext();
    await expect(
      backend.action(
        async (ctx) =>
          await prepareManagedPassword(ctx, {
            ...request,
            serviceDomain: "another.example.com",
          }),
      ),
    ).rejects.toThrow("signup host must belong");
    await expect(credentials()).resolves.toEqual([]);
  });
});
