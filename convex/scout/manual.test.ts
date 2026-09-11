import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { Firecrawl } from "firecrawl";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { connectPlaywrightBrowser, type PlaywrightBrowser } from "./playwrightBrowser";

vi.mock("./playwrightBrowser");

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../scout/${path.slice(2)}`,
      module,
    ]),
  ),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  vi.stubEnv("SCOUT_CREDENTIAL_MASTER_KEY_V1", Buffer.alloc(32, 7).toString("base64"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([undefined, Buffer.alloc(32, 8).toString("base64")])(
  "closes a persisted manual browser with an unavailable credential key (%#)",
  async (masterKey) => {
    const backend = convexTest(schema, modules);
    agentTest.register(backend);
    const { userId, scoutId } = await backend.run(async (ctx) => ({
      userId: await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
      scoutId: await ctx.db.insert("scouts", {
        displayName: "Magda",
        websiteIdentity: { firstName: "Magda", lastName: "Scout" },
        slug: "magda",
        status: "active",
        agentMail: { inboxId: "magda", address: "magda@example.test" },
        firecrawl: { profileName: "scout-magda" },
      }),
    }));
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    await admin.action(api.scout.serviceAccountCredentialActions.savePassword, {
      account: {
        kind: "create",
        scoutId,
        serviceName: "Example",
        serviceDomain: "example.com",
        identifier: "magda@example.test",
      },
      credentialHost: "example.com",
      password: { kind: "generate" },
    });
    const { threadId } = await admin.mutation(api.scout.chats.createThread, { scoutId });
    const { sessionId } = await admin.mutation(internal.scout.browserSessions.open, {
      threadId,
      scoutId,
      source: { kind: "manual" },
      providerSessionId: "browser-1",
      cdpUrl: "wss://browser.firecrawl.dev/cdp?token=test",
      interactiveLiveViewUrl: null,
      providerExpiresAtMs: Date.now() + 3600000,
      profileName: "scout-magda",
    });
    vi.stubEnv("SCOUT_CREDENTIAL_MASTER_KEY_V1", masterKey);
    const snapshot = vi.fn(async () => "");
    vi.mocked(connectPlaywrightBrowser).mockResolvedValue({
      selectTab: vi.fn(async () => true),
      selectedTabId: vi.fn(async () => "tab-1"),
      snapshot,
      navigate: vi.fn(async () => undefined),
      getPage: vi.fn(async () => "https://example.com"),
      getElement: vi.fn(async () => ""),
      getElementAttribute: vi.fn(async () => "password"),
      fill: vi.fn(async () => undefined),
      observe: vi.fn(async () => ({ capturedAtMs: 1, tabs: [] })),
      startClickCapture: vi.fn(async () => undefined),
      finishClickCapture: vi.fn<PlaywrightBrowser["finishClickCapture"]>(async () => ({
        kind: "unavailable",
      })),
    });
    const deleteBrowser = vi.spyOn(Firecrawl.prototype, "deleteBrowser").mockResolvedValue({
      success: true,
    });

    const result = await admin.action(api.scout.manual.executeTool, {
      threadId,
      toolName: "browser_close",
      input: "{}",
      operationId: "close-without-credentials",
    });

    expect(result.outcome.kind).toBe("success");
    expect(deleteBrowser).toHaveBeenCalledExactlyOnceWith("browser-1");
    expect(snapshot).not.toHaveBeenCalled();
    expect(await backend.run(async (ctx) => (await ctx.db.get(sessionId))?.lifecycle.kind)).toBe(
      "closed",
    );
  },
);
