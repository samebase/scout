import { APICallError } from "ai";
import { APIConnectionError, APIError } from "openai";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { diagnoseTaskFailure, logTaskFailure } from "./providerFailure";

afterEach(() => vi.restoreAllMocks());

function openaiError(status: number, code: string, requestId = "req-safe") {
  return new APIError(
    status,
    { code, message: "An internal error occurred." },
    "An internal error occurred.",
    new Headers({ "x-request-id": requestId, cookie: "secret-cookie" }),
  );
}

it.each([
  [429, "rate_limit_exceeded", "rate_limit"],
  [429, "insufficient_quota", "configuration"],
  [429, "usage_limit_exceeded", "configuration"],
  [401, "authentication_error", "configuration"],
  [400, "invalid_request", "configuration"],
  [404, "resource_not_found", "configuration"],
  [503, "server_overloaded", "transient_service"],
  [500, "internal_error", "transient_service"],
  [408, "request_timeout", "transient_service"],
] as const)("classifies HTTP %i / %s as %s", (status, code, category) => {
  expect(diagnoseTaskFailure(openaiError(status, code), "send", "agents_api", 123)).toEqual({
    category,
    operation: "send",
    occurredAtMs: 123,
    provider: "openai",
    httpStatus: status,
    providerCode: code,
    requestId: "req-safe",
    message: `${status} An internal error occurred.`,
  });
});

it("preserves AI SDK errors without copying request bodies or response headers", () => {
  const error = new APICallError({
    message: "Model request failed",
    url: "https://private.example.test/private?prompt=secret",
    requestBodyValues: { prompt: "secret prompt" },
    statusCode: 503,
    responseHeaders: { "x-request-id": "req-gateway", cookie: "secret-cookie" },
    responseBody: "private response",
  });
  expect(diagnoseTaskFailure(error, "advance", "convex_agent", 234)).toEqual({
    category: "transient_service",
    operation: "advance",
    occurredAtMs: 234,
    provider: "convex_gateway",
    httpStatus: 503,
    requestId: "req-gateway",
    message: "Model request failed",
  });
});

it("preserves local errors without attributing them to a provider outage", () => {
  const diagnostic = diagnoseTaskFailure(
    new Error("Browser session has closed"),
    "observe",
    "convex_agent",
    345,
  );
  expect(diagnostic).toEqual({
    category: "unknown",
    operation: "observe",
    occurredAtMs: 345,
    provider: "unknown",
    message: "Browser session has closed",
  });
  expect(
    diagnoseTaskFailure(
      new APIConnectionError({ message: "Connection reset" }),
      "advance",
      "agents_api",
      456,
    ),
  ).toMatchObject({ category: "transient_service", provider: "openai" });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  logTaskFailure({
    sessionId: "session-id",
    workflowId: null,
    providerSessionId: "session-provider",
    engine: "convex_agent",
    diagnostic,
    deliveryStatus: "submitting",
  });
  const serialized = JSON.stringify(log.mock.calls);
  expect(serialized).toContain('"deliveryStatus":"submitting"');
  expect(serialized).toContain("Browser session has closed");
  expect(serialized).not.toContain("secret-cookie");
  expect(diagnostic.message).toBe("Browser session has closed");
});

it("drops unsafe or oversized provider identifiers", () => {
  const diagnostic = diagnoseTaskFailure(
    openaiError(500, "internal_error", "x".repeat(129)),
    "advance",
    "agents_api",
    567,
  );
  expect(diagnostic.requestId).toBeUndefined();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  logTaskFailure({
    sessionId: "session-id",
    workflowId: null,
    providerSessionId: "session-id\ncookie: secret-cookie",
    engine: "agents_api",
    diagnostic,
    deliveryStatus: null,
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret-cookie");
});
