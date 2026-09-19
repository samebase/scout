import { z } from "zod";
import {
  safeToolActivityUrl,
  toolActivityLinks,
  type ToolActivity,
} from "../../shared/toolActivity";

const json = z.json();
type Json = z.infer<typeof json>;
export type ToolAudience = "member" | "admin";

// Stored arguments and SDK tool results can contain untyped provider data.
export function parseToolValue(value: unknown): Json {
  if (typeof value === "string") {
    try {
      return json.parse(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return json.parse(value);
}

export function unwrapToolOutput(value: Json): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (
      typeof value["type"] === "string" &&
      ["json", "text", "error-json", "error-text"].includes(value["type"])
    ) {
      return parseToolValue(value["value"] ?? null);
    }
  }
  return value;
}

export function toolResultError(value: Json): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value["type"] === "error-json" || value["type"] === "error-text")
    return printable(unwrapToolOutput(value)) ?? "Tool returned an error";
  if (value["type"] === "json" || value["type"] === "text")
    return toolResultError(unwrapToolOutput(value));
  if (value["error"] != null && value["error"] !== "" && value["error"] !== false)
    return printable(value["error"]);
  if (value["success"] === false || value["isError"] === true)
    return printable(value["content"] ?? value["message"] ?? value) ?? "Tool failed";
  const exitCode = value["exitCode"] ?? value["exit_code"];
  if (typeof exitCode === "number" && exitCode !== 0) return `Process exited with code ${exitCode}`;
  if (value["killed"] === true) return "Process was terminated";
  return null;
}

function printable(value: Json): string | null {
  return value === null ? null : typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

const secretKey =
  /password|passwd|secret|token|authorization|cookie|credential|api.?key|signature|cdp|live.?view|encrypted|nonce|ciphertext|authentication/i;
function safeText(value: string): string {
  return value
    .replace(
      /(?:https?|wss?):\/\/[^\s<>"'`\\]+/gi,
      (url) => safeToolActivityUrl(url) ?? "[private URL omitted]",
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi, "[credential omitted]")
    .replace(
      /((?:^|[\n;])[^\n;]*(?:password|passwd)[^\n;]*?\.fill\()\s*(?:"[^"]*"|'[^']*')/gi,
      "$1'[omitted]'",
    )
    .replace(
      /\b(password|passwd|secret|token|api[_ -]?key|authorization|cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1=[omitted]",
    )
    .replace(/\b(?:sk-|sk_live_|sk_test_|ghp_|github_pat_)[A-Za-z0-9_-]+/g, "[credential omitted]");
}

function sanitize(value: Json, depth = 0): Json {
  if (depth > 12) return "[nested content omitted]";
  if (typeof value === "string") {
    const parsed = parseToolValue(value);
    return typeof parsed === "string" ? safeText(value) : sanitize(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        secretKey.test(key) ? "[omitted]" : sanitize(entry, depth + 1),
      ]),
    );
  }
  return value;
}

function pick(value: Json, keys: string[]): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(([key]) => keys.includes(key));
  return entries.length ? Object.fromEntries(entries) : null;
}

const mailTools = new Set([
  "list_messages",
  "search_messages",
  "get_thread",
  "send_message",
  "reply_to_message",
]);

function memberDetails(name: string, input: Json, output: Json) {
  if (mailTools.has(name)) {
    return {
      input: pick(input, ["limit", "before", "after"]),
      output: pick(output, ["success", "sent", "count"]),
    };
  }
  if (
    [
      "prepare_account_password",
      "fill_account_password",
      "record_authenticated_service_account",
    ].includes(name)
  ) {
    return {
      input: pick(input, ["serviceName", "serviceDomain", "accountAccess"]),
      output: pick(output, ["filledFields", "status", "created"]),
    };
  }
  return { input, output };
}

function previewValue(value: Json): string | null {
  if (typeof value === "string")
    return (
      value
        .split("\n")
        .find((line) => line.trim())
        ?.trim() ?? null
    );
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of [
    "captureNote",
    "command",
    "code",
    "query",
    "url",
    "path",
    "site",
    "summary",
    "message",
    "serviceName",
  ]) {
    const preview = previewValue(value[key] ?? null);
    if (preview) return preview;
  }
  return null;
}

export function presentToolActivity(args: {
  id: string;
  name: string;
  state: ToolActivity["state"];
  input: Json;
  output: Json;
  error: string | null;
  audience: ToolAudience;
}): ToolActivity {
  const resultError = args.error ?? toolResultError(args.output);
  const output = unwrapToolOutput(args.output);
  const details = memberDetails(args.name, args.input, output);
  const input = args.audience === "admin" ? args.input : sanitize(details.input);
  const memberOutput = sanitize(details.output);
  const visibleOutput = args.audience === "admin" ? args.output : memberOutput;
  const error =
    resultError === null
      ? null
      : args.audience === "admin"
        ? resultError
        : mailTools.has(args.name)
          ? null
          : safeText(resultError);
  const state = resultError === null || args.state === "interrupted" ? args.state : "failed";
  function display(value: Json) {
    const text = printable(value);
    return args.audience === "member" && text && text.length > 12_000
      ? `${text.slice(0, 12_000)}\n[Display truncated]`
      : text;
  }
  return {
    id: args.id,
    name: args.name,
    state,
    input: display(input),
    output: display(visibleOutput),
    error,
    preview: (previewValue(input) ?? error ?? previewValue(visibleOutput))?.slice(0, 180) ?? null,
    links: toolActivityLinks(memberOutput),
    captures: [],
  };
}
