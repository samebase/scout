"use node";

import { vWorkflowId } from "@convex-dev/workflow";
import { APICallError } from "ai";
import type { Infer } from "convex/values";
import { APIConnectionError, APIError } from "openai";
import { taskEngine } from "./model";
import { omitNullish } from "../../shared/omitNullish";
import type { TaskFailureDiagnostic } from "../../shared/taskFailure";

type TaskEngine = Infer<typeof taskEngine>;
type Operation = TaskFailureDiagnostic["operation"];

function boundedIdentifier(value: string | null | undefined) {
  return value && value.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : undefined;
}

export function diagnoseTaskFailure(
  error: unknown,
  operation: Operation,
  engine: TaskEngine | null,
  occurredAtMs: number = Date.now(),
): TaskFailureDiagnostic {
  const provider =
    error instanceof APIError
      ? "openai"
      : APICallError.isInstance(error) && engine === "convex_agent"
        ? "convex_gateway"
        : "unknown";
  if (!(error instanceof APIError) && !APICallError.isInstance(error))
    return { category: "unknown", operation, occurredAtMs, provider };

  const status = error instanceof APIError ? error.status : error.statusCode;
  const code = error instanceof APIError ? boundedIdentifier(error.code) : undefined;
  const category =
    code === "insufficient_quota" ||
    code === "usage_limit_exceeded" ||
    code === "authentication_error" ||
    code === "invalid_request" ||
    code === "resource_not_found" ||
    code === "invalid_api_key" ||
    status === 401 ||
    status === 403
      ? "configuration"
      : code === "rate_limit_exceeded" || status === 429
        ? "rate_limit"
        : code === "server_overloaded" ||
            code === "connection_failed" ||
            code === "server_error" ||
            code === "request_timeout" ||
            code === "internal_error" ||
            error instanceof APIConnectionError ||
            status === 408 ||
            (status !== undefined && status >= 500)
          ? "transient_service"
          : "unknown";
  return {
    category,
    operation,
    occurredAtMs,
    provider,
    ...omitNullish({
      httpStatus:
        status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599
          ? status
          : null,
      providerCode: code,
      requestId: boundedIdentifier(
        error instanceof APIError
          ? error.requestID
          : (error.responseHeaders?.["x-request-id"] ?? error.responseHeaders?.["X-Request-Id"]),
      ),
    }),
  };
}

export function logTaskFailure({
  sessionId,
  workflowId,
  providerSessionId,
  engine,
  diagnostic,
  deliveryStatus,
}: {
  sessionId: string;
  workflowId: Infer<typeof vWorkflowId> | null;
  providerSessionId: string | null;
  engine: TaskEngine | null;
  diagnostic: TaskFailureDiagnostic;
  deliveryStatus: "queued" | "submitting" | null;
}) {
  console.error("Task failure", {
    sessionId,
    workflowId,
    providerSessionId: boundedIdentifier(providerSessionId) ?? null,
    provider: diagnostic.provider,
    engine,
    operation: diagnostic.operation,
    diagnostic,
    ...omitNullish({ deliveryStatus }),
  });
}
