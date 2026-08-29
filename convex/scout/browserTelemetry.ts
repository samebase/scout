import { type Infer } from "convex/values";
import { z } from "zod";
import {
  claimTestBrowserActionValidator,
  claimTestBrowserTelemetryValidator,
} from "../claimTestBrowserModel";

const MAX_TAB_COUNT = 20;
const MAX_ID_LENGTH = 256;
const MAX_TITLE_LENGTH = 500;

const tabSchema = z.object({
  tabId: z.string().min(1).max(MAX_ID_LENGTH),
  title: z.string().max(MAX_TITLE_LENGTH).catch(""),
  url: z.string().max(4_000).catch(""),
  active: z.boolean(),
});

const tabsEnvelopeSchema = z.object({
  data: z.object({
    tabs: z.array(tabSchema).max(MAX_TAB_COUNT),
  }),
});

const boxEnvelopeSchema = z.object({
  data: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  }),
});

export type ClaimTestBrowserAction = Infer<typeof claimTestBrowserActionValidator>;
export type ClaimTestBrowserTelemetry = Infer<typeof claimTestBrowserTelemetryValidator>;

export type ParsedBrowserTrace = {
  telemetry: ClaimTestBrowserTelemetry;
  modelOutput: string;
};

export function browserTraceMarkers(token: string) {
  return {
    begin: `__SCOUT_TRACE_${token}_BEGIN__`,
    end: `__SCOUT_TRACE_${token}_END__`,
    dispatch: `__SCOUT_TRACE_${token}_DISPATCH__`,
  };
}

export function actionElementRef(action: ClaimTestBrowserAction) {
  switch (action.kind) {
    case "click":
    case "fill":
    case "type":
    case "select":
    case "check":
      return action.ref;
    case "open":
    case "navigate":
    case "press":
    case "back":
    case "reload":
    case "switch_tab":
      return null;
  }
}

function timestamp(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Browser telemetry has an invalid ${label}`);
  }
  return parsed;
}

function displayUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function tabs(value: string) {
  const parsed = tabsEnvelopeSchema.parse(JSON.parse(value));
  return parsed.data.tabs.map((tab) => ({
    tabId: tab.tabId,
    title: tab.title,
    url: displayUrl(tab.url),
    active: tab.active,
  }));
}

function activeTabId(value: ReturnType<typeof tabs>) {
  const active = value.filter((tab) => tab.active);
  if (active.length !== 1) {
    throw new Error("Browser telemetry must identify exactly one active tab");
  }
  return active[0]?.tabId ?? "";
}

export function parseBrowserTrace(
  stdout: string,
  token: string,
  action: ClaimTestBrowserAction,
): ParsedBrowserTrace {
  const markers = browserTraceMarkers(token);
  const begin = stdout.indexOf(`${markers.begin}\n`);
  if (begin < 0) throw new Error("Browser telemetry start marker is missing");
  const traceStart = begin + markers.begin.length + 1;
  const end = stdout.indexOf(`\n${markers.end}`, traceStart);
  if (end < 0) throw new Error("Browser telemetry end marker is missing");

  const lines = stdout.slice(traceStart, end).split("\n");
  const ref = actionElementRef(action);
  const expectedLines = ref === null ? 5 : 6;
  if (lines.length !== expectedLines) {
    throw new Error("Browser telemetry envelope has an invalid shape");
  }

  const beforeTabs = tabs(lines[1] ?? "");
  const dispatchedAtMs = timestamp(lines[ref === null ? 2 : 3] ?? "", "dispatch time");
  const returnedAtMs = timestamp(lines[ref === null ? 3 : 4] ?? "", "return time");
  const afterTabs = tabs(lines[ref === null ? 4 : 5] ?? "");
  const beforeCapturedAtMs = timestamp(lines[0] ?? "", "capture time");
  if (dispatchedAtMs < beforeCapturedAtMs || returnedAtMs < dispatchedAtMs) {
    throw new Error("Browser telemetry timestamps are out of order");
  }

  const pointer =
    ref === null
      ? null
      : (() => {
          const box = boxEnvelopeSchema.parse(JSON.parse(lines[2] ?? "")).data;
          return {
            tabId: activeTabId(beforeTabs),
            ref,
            box,
          };
        })();

  return {
    telemetry: {
      version: 1,
      before: { capturedAtMs: beforeCapturedAtMs, tabs: beforeTabs },
      dispatchedAtMs,
      returnedAtMs,
      after: { capturedAtMs: returnedAtMs, tabs: afterTabs },
      pointer,
    },
    modelOutput: stdout.slice(end + markers.end.length + 1).trimStart(),
  };
}
