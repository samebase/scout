import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  closeScrapeInteractSession,
  createScrapeInteractSession,
  executeScrapeInteractCode,
  type ScrapeInteraction,
} from "./lib/firecrawl";

const MAX_TOOL_TEXT_LENGTH = 20_000;
const MAX_TOOL_OUTPUT_LENGTH = 20_000;

const agentMailToolNames = [
  "list_inboxes",
  "list_messages",
  "search_messages",
  "get_thread",
] as const;

type BrowserStopResult = {
  success: boolean;
  sessionDurationMs: number | null;
  creditsBilled: number | null;
  replayAvailable: boolean;
};

type BrowserDependencies = {
  createSession: typeof createScrapeInteractSession;
  executeCode: typeof executeScrapeInteractCode;
  closeSession: typeof closeScrapeInteractSession;
};

type LabBrowserHarnessOptions = {
  profileName?: string;
};

const defaultBrowserDependencies: BrowserDependencies = {
  createSession: createScrapeInteractSession,
  executeCode: executeScrapeInteractCode,
  closeSession: closeScrapeInteractSession,
};

function boundedText(value: string, label: string) {
  const text = value.trim();
  if (!text) {
    throw new Error(`${label} cannot be empty`);
  }
  if (text.length > MAX_TOOL_TEXT_LENGTH) {
    throw new Error(`${label} must be ${MAX_TOOL_TEXT_LENGTH} characters or fewer`);
  }
  return text;
}

function elementRef(value: string) {
  if (!/^@e\d+$/.test(value)) {
    throw new Error("Element ref must look like @e1");
  }
  return value;
}

function httpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Browser URLs must use HTTPS");
  }
  return url.toString();
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function redactProviderUrls(value: string) {
  return value.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      return url.hostname === "firecrawl.dev" || url.hostname.endsWith(".firecrawl.dev")
        ? "[Firecrawl URL redacted]"
        : candidate;
    } catch {
      return candidate;
    }
  });
}

function browserOutput(interaction: ScrapeInteraction) {
  const output = interaction.stdout || interaction.result || interaction.output;
  return {
    success: interaction.success,
    output: redactProviderUrls(output).slice(0, MAX_TOOL_OUTPUT_LENGTH),
    error: interaction.error
      ? redactProviderUrls(interaction.error).slice(0, MAX_TOOL_OUTPUT_LENGTH)
      : null,
    exitCode: interaction.exitCode,
    killed: interaction.killed,
    replayAvailable: interaction.replayAvailable,
  };
}

export function selectAgentMailTools(tools: ToolSet) {
  const selected: ToolSet = {};
  for (const name of agentMailToolNames) {
    const selectedTool = tools[name];
    if (!selectedTool) {
      throw new Error(`AgentMail MCP tool ${name} is unavailable`);
    }
    selected[name] = selectedTool;
  }
  return selected;
}

export function createLabBrowserHarness(
  options: LabBrowserHarnessOptions = {},
  dependencies: BrowserDependencies = defaultBrowserDependencies,
) {
  let scrapeId: string | undefined;
  let closePromise: Promise<BrowserStopResult> | undefined;
  let stopResult: BrowserStopResult | undefined;
  let operationTail: Promise<void> = Promise.resolve();

  function serialized<T>(operation: () => Promise<T>) {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function execute(parts: readonly string[], timeoutSeconds = 60) {
    return serialized(async () => {
      if (!scrapeId) {
        throw new Error("Open a browser session before using it");
      }
      const command = parts.map(shellQuote).join(" ");
      const interaction = await dependencies.executeCode(scrapeId, command, timeoutSeconds, "bash");
      return browserOutput(interaction);
    });
  }

  function open(url: string) {
    return serialized(async () => {
      if (scrapeId) {
        throw new Error("A browser session is already open");
      }
      if (stopResult) {
        throw new Error("This response already used and closed its browser session");
      }

      const session = await dependencies.createSession(httpsUrl(url), options.profileName);
      scrapeId = session.scrapeId;
      const snapshot = await dependencies.executeCode(
        scrapeId,
        "agent-browser snapshot -i",
        60,
        "bash",
      );
      return browserOutput(snapshot);
    });
  }

  function close(): Promise<BrowserStopResult | undefined> {
    return serialized(async () => {
      if (stopResult) {
        return stopResult;
      }
      if (closePromise) {
        return await closePromise;
      }
      if (!scrapeId) {
        return undefined;
      }
      const sessionToClose = scrapeId;
      closePromise = dependencies.closeSession(sessionToClose).then((result) => {
        if (!result.success) {
          throw new Error("Firecrawl did not stop the browser session");
        }
        scrapeId = undefined;
        stopResult = result;
        return result;
      });
      try {
        return await closePromise;
      } finally {
        closePromise = undefined;
      }
    });
  }

  const actions = {
    snapshot: async () => await execute(["agent-browser", "snapshot", "-i"]),
    navigate: async (url: string) => await execute(["agent-browser", "open", httpsUrl(url)]),
    click: async (ref: string) => await execute(["agent-browser", "click", elementRef(ref)]),
    fill: async (ref: string, text: string) =>
      await execute(["agent-browser", "fill", elementRef(ref), text]),
    type: async (ref: string, text: string) =>
      await execute(["agent-browser", "type", elementRef(ref), text]),
    press: async (key: string) =>
      await execute(["agent-browser", "press", boundedText(key, "Key")]),
    select: async (ref: string, value: string) =>
      await execute(["agent-browser", "select", elementRef(ref), value]),
    check: async (ref: string) => await execute(["agent-browser", "check", elementRef(ref)]),
    getPage: async (kind: "url" | "title") => await execute(["agent-browser", "get", kind]),
    getElement: async (kind: "text" | "value", ref: string) =>
      await execute(["agent-browser", "get", kind, elementRef(ref)]),
    waitForText: async (text: string) => await execute(["agent-browser", "wait", "--text", text]),
    waitForLoad: async (state: "domcontentloaded" | "networkidle") =>
      await execute(["agent-browser", "wait", "--load", state]),
    waitForMilliseconds: async (duration: number) =>
      await execute(["agent-browser", "wait", String(duration)]),
    back: async () => await execute(["agent-browser", "back"]),
    reload: async () => await execute(["agent-browser", "reload"]),
  };

  const tools = {
    browser_open: tool({
      description:
        "Open one admin-configured Firecrawl browser session at an HTTPS URL and return an interactive accessibility snapshot. The session identity and provider URLs stay outside the model.",
      inputSchema: z.object({
        url: z.string().url().describe("HTTPS page to open"),
      }),
      execute: async ({ url }) => await open(url),
    }),
    browser_snapshot: tool({
      description:
        "Inspect the current page and return interactive elements with stable refs such as @e1.",
      inputSchema: z.object({}),
      execute: actions.snapshot,
    }),
    browser_navigate: tool({
      description: "Navigate the current browser session to another HTTPS URL.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => await actions.navigate(url),
    }),
    browser_click: tool({
      description: "Click an element ref from the latest browser snapshot.",
      inputSchema: z.object({ ref: z.string().describe("Element ref such as @e3") }),
      execute: async ({ ref }) => await actions.click(ref),
    }),
    browser_fill: tool({
      description: "Replace the value of a form field selected by element ref.",
      inputSchema: z.object({
        ref: z.string().describe("Element ref such as @e3"),
        text: z.string().max(MAX_TOOL_TEXT_LENGTH),
      }),
      execute: async ({ ref, text }) => await actions.fill(ref, text),
    }),
    browser_type: tool({
      description: "Type text into an element without first replacing its current value.",
      inputSchema: z.object({
        ref: z.string().describe("Element ref such as @e3"),
        text: z.string().max(MAX_TOOL_TEXT_LENGTH),
      }),
      execute: async ({ ref, text }) => await actions.type(ref, text),
    }),
    browser_press: tool({
      description: "Press one keyboard key or key combination in the focused page.",
      inputSchema: z.object({ key: z.string().min(1).max(100) }),
      execute: async ({ key }) => await actions.press(key),
    }),
    browser_select: tool({
      description: "Select an option in a select control by element ref and value.",
      inputSchema: z.object({
        ref: z.string().describe("Element ref such as @e3"),
        value: z.string().max(MAX_TOOL_TEXT_LENGTH),
      }),
      execute: async ({ ref, value }) => await actions.select(ref, value),
    }),
    browser_check: tool({
      description: "Set a checkbox or radio control to checked.",
      inputSchema: z.object({ ref: z.string().describe("Element ref such as @e3") }),
      execute: async ({ ref }) => await actions.check(ref),
    }),
    browser_get: tool({
      description: "Read the current URL/title or the text/value of one element ref.",
      inputSchema: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("url") }),
        z.object({ kind: z.literal("title") }),
        z.object({ kind: z.literal("text"), ref: z.string() }),
        z.object({ kind: z.literal("value"), ref: z.string() }),
      ]),
      execute: async (input) => {
        switch (input.kind) {
          case "url":
          case "title":
            return await actions.getPage(input.kind);
          case "text":
          case "value":
            return await actions.getElement(input.kind, input.ref);
        }
      },
    }),
    browser_wait: tool({
      description: "Wait for visible text, a page-load state, or a short fixed duration.",
      inputSchema: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("text"), text: z.string().min(1).max(1_000) }),
        z.object({
          kind: z.literal("load"),
          state: z.enum(["domcontentloaded", "networkidle"]),
        }),
        z.object({
          kind: z.literal("milliseconds"),
          duration: z.number().int().min(1).max(10_000),
        }),
      ]),
      execute: async (input) => {
        switch (input.kind) {
          case "text":
            return await actions.waitForText(input.text);
          case "load":
            return await actions.waitForLoad(input.state);
          case "milliseconds":
            return await actions.waitForMilliseconds(input.duration);
        }
      },
    }),
    browser_back: tool({
      description: "Navigate back once in browser history.",
      inputSchema: z.object({}),
      execute: actions.back,
    }),
    browser_reload: tool({
      description: "Reload the current page.",
      inputSchema: z.object({}),
      execute: actions.reload,
    }),
    browser_close: tool({
      description:
        "Stop the current Firecrawl browser session and report provider duration and credits. Call once after browser work is complete.",
      inputSchema: z.object({}),
      execute: async () => (await close()) ?? { success: true, alreadyClosed: true },
    }),
  } satisfies ToolSet;

  return { tools, actions, open, close };
}
