import { env } from "../../_generated/server";

const MAX_PROVIDER_ERROR_LENGTH = 1_000;
const MILLISECONDS_PER_SECOND = 1_000;

type ScoutEnvName = "AGENTMAIL_API_KEY" | "FIRECRAWL_API_KEY";

export class ProviderHttpError extends Error {
  readonly provider: string;
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly resetAtMs: number | null;

  constructor(options: {
    provider: string;
    status: number;
    detail: string;
    retryAfterMs: number | null;
    resetAtMs: number | null;
  }) {
    super(
      `${options.provider} request failed (${options.status})${options.detail ? `: ${options.detail}` : ""}`,
    );
    this.name = "ProviderHttpError";
    this.provider = options.provider;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.resetAtMs = options.resetAtMs;
  }
}

function nonNegativeDelay(value: number) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function parseRetryAfter(value: string | null, nowMs: number) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return nonNegativeDelay(seconds * MILLISECONDS_PER_SECOND);
  }
  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? null : nonNegativeDelay(dateMs - nowMs);
}

function parseReset(value: string | null, nowMs: number) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric >= 1_000_000_000_000) return Math.round(numeric);
    if (numeric >= 1_000_000_000) return Math.round(numeric * MILLISECONDS_PER_SECOND);
    return Math.round(nowMs + numeric * MILLISECONDS_PER_SECOND);
  }
  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? null : dateMs;
}

function retryAfterFromBody(body: string) {
  const match = body.match(/retry\s+after\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return nonNegativeDelay(/^(?:ms|milliseconds?)$/i.test(match[2] ?? "") ? amount : amount * 1_000);
}

function resetAtFromBody(body: string) {
  const match = body.match(/resets?\s+at\s+([^,;\n]+)/i);
  if (!match) return null;
  const parsed = Date.parse(match[1]?.trim() ?? "");
  return Number.isNaN(parsed) ? null : parsed;
}

export function requireEnv(name: ScoutEnvName) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export async function fetchJson(
  provider: string,
  input: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetch(input, init);
  const body = await response.text();

  if (!response.ok) {
    const detail = body.trim().slice(0, MAX_PROVIDER_ERROR_LENGTH);
    const nowMs = Date.now();
    const retryAfterMs =
      parseRetryAfter(response.headers.get("retry-after"), nowMs) ?? retryAfterFromBody(body);
    const resetAtMs =
      parseReset(
        response.headers.get("x-ratelimit-reset") ?? response.headers.get("ratelimit-reset"),
        nowMs,
      ) ?? resetAtFromBody(body);
    throw new ProviderHttpError({
      provider,
      status: response.status,
      detail,
      retryAfterMs,
      resetAtMs,
    });
  }

  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${provider} returned invalid JSON`);
  }
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid response`);
  }
  return value as Record<string, unknown>;
}

export function requireString(record: Record<string, unknown>, field: string, label: string) {
  const value = record[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} response is missing ${field}`);
  }
  return value;
}
