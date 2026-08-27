import { tool, type ToolSet } from "ai";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createLabBrowserHarness, selectAgentMailTools } from "./labTools";
import type { ScrapeInteraction } from "./lib/firecrawl";

function interaction(overrides: Partial<ScrapeInteraction> = {}): ScrapeInteraction {
  return {
    success: true,
    stdout: '- textbox "Email" [ref=e1]',
    result: "",
    stderr: "",
    exitCode: 0,
    killed: false,
    error: null,
    output: "",
    replayAvailable: false,
    ...overrides,
  };
}

function dependencies() {
  return {
    createSession: vi.fn(async () => ({ scrapeId: "scrape-1" })),
    executeCode: vi.fn(async () => interaction()),
    closeSession: vi.fn(async () => ({
      success: true,
      sessionDurationMs: 1_500,
      creditsBilled: 2,
      replayAvailable: true,
    })),
  };
}

describe("Lab browser harness", () => {
  test("opens fresh by default and returns a sanitized interactive snapshot", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.open("https://example.com/login")).resolves.toEqual({
      success: true,
      output: '- textbox "Email" [ref=e1]',
      error: null,
      exitCode: 0,
      killed: false,
      replayAvailable: false,
    });
    expect(deps.createSession).toHaveBeenCalledWith("https://example.com/login", undefined);
    expect(deps.executeCode).toHaveBeenCalledWith(
      "scrape-1",
      "agent-browser snapshot -i",
      60,
      "bash",
    );
  });

  test("loads a persistent profile only from trusted harness configuration", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({ profileName: "scout-conrad" }, deps);

    await browser.open("https://example.com");

    expect(deps.createSession).toHaveBeenCalledWith("https://example.com/", "scout-conrad");
  });

  test("constructs shell-quoted commands from structured actions", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await browser.actions.fill("@e1", "hello & env; $(whoami) 'quoted'");

    expect(deps.executeCode).toHaveBeenLastCalledWith(
      "scrape-1",
      `'agent-browser' 'fill' '@e1' 'hello & env; $(whoami) '"'"'quoted'"'"''`,
      60,
      "bash",
    );
  });

  test("rejects invalid refs and non-HTTPS navigation before contacting Firecrawl", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(browser.actions.click("button.login")).rejects.toThrow("must look like @e1");
    await expect(browser.actions.navigate("http://example.com")).rejects.toThrow("must use HTTPS");
    expect(deps.executeCode).toHaveBeenCalledTimes(1);
  });

  test("requires an open session and prevents commands after close", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.actions.snapshot()).rejects.toThrow("Open a browser session");
    await browser.open("https://example.com");
    await browser.close();
    await expect(browser.actions.snapshot()).rejects.toThrow("Open a browser session");
  });

  test("serializes concurrent commands against one browser session", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    deps.executeCode
      .mockImplementationOnce(async () => {
        await first;
        return interaction({ stdout: "first" });
      })
      .mockImplementationOnce(async () => interaction({ stdout: "second" }));

    const firstRun = browser.actions.getPage("url");
    const secondRun = browser.actions.snapshot();
    await vi.waitFor(() => expect(deps.executeCode).toHaveBeenCalledTimes(2));
    releaseFirst?.();

    await expect(firstRun).resolves.toMatchObject({ output: "first" });
    await expect(secondRun).resolves.toMatchObject({ output: "second" });
    expect(deps.executeCode).toHaveBeenCalledTimes(3);
  });

  test("closes once and preserves Firecrawl accounting", async () => {
    const deps = dependencies();
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    const firstClose = await browser.close();
    const secondClose = await browser.close();

    expect(firstClose).toEqual({
      success: true,
      sessionDurationMs: 1_500,
      creditsBilled: 2,
      replayAvailable: true,
    });
    expect(secondClose).toEqual(firstClose);
    expect(deps.closeSession).toHaveBeenCalledTimes(1);
  });

  test("keeps the session active when Firecrawl refuses to close it", async () => {
    const deps = dependencies();
    deps.closeSession
      .mockResolvedValueOnce({
        success: false,
        sessionDurationMs: 0,
        creditsBilled: 0,
        replayAvailable: false,
      })
      .mockResolvedValueOnce({
        success: true,
        sessionDurationMs: 2_000,
        creditsBilled: 2,
        replayAvailable: false,
      });
    const browser = createLabBrowserHarness({}, deps);
    await browser.open("https://example.com");

    await expect(browser.close()).rejects.toThrow("did not stop");
    await expect(browser.actions.snapshot()).resolves.toMatchObject({ success: true });
    await expect(browser.close()).resolves.toMatchObject({ success: true });
    expect(deps.closeSession).toHaveBeenCalledTimes(2);
  });

  test("redacts provider URLs before returning tool output", async () => {
    const deps = dependencies();
    deps.executeCode.mockResolvedValueOnce(
      interaction({ stdout: "watch https://sessions.firecrawl.dev/live?token=secret" }),
    );
    const browser = createLabBrowserHarness({}, deps);

    await expect(browser.open("https://example.com")).resolves.toMatchObject({
      output: "watch [Firecrawl URL redacted]",
    });
  });
});

describe("AgentMail Lab catalog", () => {
  test("keeps only the four read tools", () => {
    const readTool = tool({ inputSchema: z.object({}), execute: async () => null });
    const allTools: ToolSet = {
      list_inboxes: readTool,
      list_messages: readTool,
      search_messages: readTool,
      get_thread: readTool,
      send_message: readTool,
      delete_inbox: readTool,
    };

    expect(Object.keys(selectAgentMailTools(allTools))).toEqual([
      "list_inboxes",
      "list_messages",
      "search_messages",
      "get_thread",
    ]);
  });

  test("fails closed when the hosted catalog loses a required tool", () => {
    const readTool = tool({ inputSchema: z.object({}), execute: async () => null });

    expect(() => selectAgentMailTools({ list_inboxes: readTool })).toThrow(
      "AgentMail MCP tool list_messages is unavailable",
    );
  });
});
