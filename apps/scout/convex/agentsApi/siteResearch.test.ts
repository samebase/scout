/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { Firecrawl } from "firecrawl";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { saveWorkspaceFile } from "../scout/workspaceTools";
import {
  researchSite,
  researchCandidates,
  selectedPages,
  renderBrief,
} from "./siteResearchSources";

vi.mock("../scout/workspaceTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scout/workspaceTools")>()),
  saveWorkspaceFile: vi.fn().mockResolvedValue(undefined),
}));

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../agentsApi/${path.slice(2)}`,
      module,
    ]),
  ),
};

const scrape = vi.fn<Firecrawl["scrape"]>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  vi.mocked(saveWorkspaceFile).mockClear();
  scrape.mockReset().mockResolvedValue({
    markdown: "Example Product. Public calculator with no account required.",
    links: [],
    metadata: { statusCode: 200, creditsUsed: 1, sourceURL: "https://example.com/" },
  });
  vi.spyOn(Firecrawl.prototype, "scrape").mockImplementation(scrape);
  vi.spyOn(Firecrawl.prototype, "map").mockResolvedValue({ links: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(prompt = "Try https://example.com and tell me whether it works.") {
  const backend = convexTest(schema, modules);
  workflowTest.register(backend);
  agentTest.register(backend);
  const { userId, scoutId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "profile" },
    });
    return { userId, scoutId };
  });
  const admin = backend.withIdentity({ subject: userId });
  await admin.mutation(api.scout.chats.startProductChat, {
    scoutId,
    prompt,
    kind: "review",
    visibility: "private",
  });
  const session = await backend.run((ctx) => ctx.db.query("agentsApiSessions").unique());
  if (!session) throw new Error("Missing session");
  const check = await backend.run((ctx) => ctx.db.query("agentsApiRequestChecks").unique());
  if (!check) throw new Error("Missing check");
  await backend.run((ctx) =>
    ctx.db.patch(check._id, {
      state: {
        kind: "completed",
        finishedAt: Date.now(),
        call: { startedAt: Date.now(), request: "{}", response: "{}", usage: null },
        result: { kind: "initial", title: "Test Example", decision: { kind: "approved" } },
      },
    }),
  );
  return {
    backend,
    admin,
    sessionId: session._id,
    checkId: check._id,
    prompt,
    run: () =>
      backend.action(internal.agentsApi.siteResearch.run, { sessionId: session._id, prompt }),
    inspect: () =>
      admin.query(api.agentsApi.siteResearchRecords.inspect, { sessionId: session._id }),
  };
}

function mockProviders() {
  let calls = 0;
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new Request(input, init).url;
    if (url.endsWith("/scrape"))
      return Response.json({
        success: true,
        data: {
          markdown: "Example Product. Public calculator with no account required.",
          links: [],
          metadata: { statusCode: 200, creditsUsed: 1, sourceURL: "https://example.com/" },
        },
      });
    if (url.includes("/map")) return Response.json({ success: true, links: [] });
    if (url.endsWith("/responses")) {
      const result =
        calls++ === 0
          ? { pages: [], reason: "Landing page suffices" }
          : {
              overview: "A public calculator.",
              facts: [{ text: "No account required.", sources: [0] }],
              unknowns: [],
            };
      return Response.json({
        id: `resp-${calls}`,
        object: "response",
        status: "completed",
        model: "gpt-5.6-luna",
        output: [
          {
            id: `msg-${calls}`,
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: JSON.stringify(result), annotations: [] }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
      });
    }
    throw new Error(`Unexpected provider call: ${url}`);
  });
  vi.stubGlobal("fetch", request);
  return request;
}

it("collects once after approval, preserves private request data, and records costs and the frozen brief", async () => {
  const t = await setup(
    "Try https://example.com/secret-invite?token=private-token. My private note is secret-note.",
  );
  const request = mockProviders();
  await t.run();
  const research = await t.inspect();
  expect(research?.state.kind, JSON.stringify(research?.state)).toBe("completed");
  expect(research).toMatchObject({
    site: "example.com",
    state: { kind: "completed", brief: expect.stringContaining("A public calculator") },
    calls: [
      { name: "landing", credits: 1 },
      { name: "map" },
      { name: "selection" },
      { name: "brief" },
    ],
  });
  expect(research?.modelCost).toBeCloseTo(0.000064);
  const files = vi.mocked(saveWorkspaceFile).mock.calls.map(([, args]) => args);
  expect(
    files
      .filter((file) => file.target.kind === "site")
      .every((file) => !file.text.includes("secret-note") && !file.text.includes("private-token")),
  ).toBe(true);
  expect(files.find((file) => file.path.endsWith("selection-request.json"))?.text).toContain(
    t.prompt,
  );
  expect(
    files.some((file) => file.target.kind === "agent_session" && file.path.endsWith("brief.md")),
  ).toBe(true);
  expect((await t.backend.run((ctx) => ctx.db.query("scoutChats").unique()))?.primarySite).toBe(
    "example.com",
  );
  await t.run();
  expect(request).toHaveBeenCalledTimes(2);
  expect(scrape).toHaveBeenCalledTimes(1);
  await expect(
    t.backend.query(api.agentsApi.siteResearchRecords.inspect, { sessionId: t.sessionId }),
  ).rejects.toThrow();
});

it("skips ambiguous sites without provider calls", async () => {
  const t = await setup("Compare https://example.com with https://example.org");
  const request = mockProviders();
  await t.run();
  expect((await t.inspect())?.state.kind).toBe("skipped");
  expect(request).not.toHaveBeenCalled();
});

it("cannot research a rejected request", async () => {
  const t = await setup();
  await t.backend.run((ctx) => ctx.db.patch(t.checkId, { state: { kind: "cancelled" } }));
  const request = mockProviders();
  await expect(t.run()).rejects.toThrow("approved request");
  expect(request).not.toHaveBeenCalled();
});

it("records a scrape failure without failing the approved session", async () => {
  const t = await setup();
  scrape.mockRejectedValue(new Error("Site unavailable"));
  await t.run();
  expect((await t.inspect())?.state.kind).toBe("failed");
  expect((await t.backend.run((ctx) => ctx.db.get(t.sessionId)))?.state.kind).toBe("starting");
});

it("stops between requests and cannot start the browser afterward", async () => {
  const t = await setup();
  const request = vi.fn<typeof fetch>(async () => {
    await t.admin.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
    return Response.json({
      success: true,
      data: { markdown: "Home", links: [], metadata: { statusCode: 200 } },
    });
  });
  vi.stubGlobal("fetch", request);
  scrape.mockImplementation(async () => {
    await t.admin.mutation(api.agentsApi.sessions.stop, { sessionId: t.sessionId });
    return { markdown: "Home", links: [], metadata: { statusCode: 200 } };
  });
  await t.run();
  expect((await t.inspect())?.state.kind).toBe("cancelled");
  expect(request).not.toHaveBeenCalled();
  expect(
    await t.backend.action(internal.agentsApi.runtime.begin, {
      sessionId: t.sessionId,
      command: { kind: "start", prompt: t.prompt, checkId: t.checkId },
    }),
  ).toBe(false);
  expect(request).not.toHaveBeenCalled();
});

it("uses only public origins and observed same-site candidates", () => {
  expect(researchSite("Try (https://example.com/invite?token=abc).")).toBe("example.com");
  for (const text of [
    "Find a calculator",
    "https://127.0.0.1",
    "https://localhost:5173",
    "https://u:p@example.com",
    "http://example.com",
  ])
    expect(researchSite(text)).toBeNull();
  const candidates = researchCandidates("example.com", [
    { url: "/help", title: "Help" },
    { url: "https://evil-example.com/help", title: "Wrong site" },
    { url: "https://example.com/help?token=abc", title: "Private" },
    { url: "https://docs.example.com/start", title: "Docs" },
  ]);
  expect(candidates.map((page) => page.url)).toEqual([
    "https://example.com/help",
    "https://docs.example.com/start",
  ]);
  expect(() =>
    selectedPages({ pages: [{ index: 2, reason: "made up" }], reason: "" }, candidates),
  ).toThrow("outside");
  expect(() =>
    renderBrief(
      "example.com",
      { overview: "Test", facts: [{ text: "unsupported", sources: [0] }], unknowns: [] },
      [],
    ),
  ).toThrow("not read");
});
