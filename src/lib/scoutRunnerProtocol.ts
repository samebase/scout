import { z } from "zod";
import { runnerToolNames } from "../../convex/scout/runnerToolNames.ts";

const jsonObjectSchema = z.record(z.string(), z.json());
export const runnerToolNameSchema = z.enum(runnerToolNames);

export const runnerToolDefinitionSchema = z.object({
  name: runnerToolNameSchema,
  description: z.string().min(1),
  inputSchema: jsonObjectSchema,
});

export const serializedRunnerToolDefinitionSchema = z.object({
  name: runnerToolNameSchema,
  description: z.string().min(1),
  inputSchemaJson: z.string().min(1),
});

export type RunnerToolDefinition = z.infer<typeof runnerToolDefinitionSchema>;

export const preparedScoutRunSchema = z.object({
  threadId: z.string().min(1),
  promptMessageId: z.string().min(1),
  chatUrl: z.url(),
  instructions: z.string().min(1),
  tools: z.array(runnerToolDefinitionSchema).min(1),
});

export type PreparedScoutRun = z.infer<typeof preparedScoutRunSchema>;

export const manualToolResultSchema = z.object({
  toolCallId: z.string().min(1),
  outcome: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("success"), output: z.string() }),
    z.object({ kind: z.literal("error"), error: z.string() }),
  ]),
});

export type ManualToolResult = z.infer<typeof manualToolResultSchema>;

export const runnerTurnOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("completed"), response: z.string().min(1) }),
  z.object({ kind: z.literal("failed"), error: z.string().min(1) }),
]);

export type RunnerTurnOutcome = z.infer<typeof runnerTurnOutcomeSchema>;

export const browserBridgeRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("prepare"),
    requestId: z.uuid(),
    scoutSlug: z.string().min(1),
    prompt: z.string().min(1),
  }),
  z.object({
    kind: z.literal("callTool"),
    requestId: z.uuid(),
    threadId: z.string().min(1),
    promptMessageId: z.string().min(1),
    toolName: runnerToolNameSchema,
    input: jsonObjectSchema,
  }),
  z.object({
    kind: z.literal("finish"),
    requestId: z.uuid(),
    threadId: z.string().min(1),
    promptMessageId: z.string().min(1),
    outcome: runnerTurnOutcomeSchema,
  }),
]);

export type BrowserBridgeRequest = z.infer<typeof browserBridgeRequestSchema>;

export const browserBridgeResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("success"),
    requestId: z.uuid(),
    value: z.json(),
  }),
  z.object({
    kind: z.literal("error"),
    requestId: z.uuid(),
    error: z.string().min(1),
  }),
]);

export type BrowserBridgeResponse = z.infer<typeof browserBridgeResponseSchema>;

export const mcpBridgeToolCallSchema = z.object({
  threadId: z.string().min(1),
  toolName: runnerToolNameSchema,
  input: jsonObjectSchema,
});
export type McpBridgeToolCall = z.infer<typeof mcpBridgeToolCallSchema>;

export const runnerContextSchema = preparedScoutRunSchema.pick({
  threadId: true,
  instructions: true,
  tools: true,
});

export type RunnerContext = z.infer<typeof runnerContextSchema>;

export function parseLoopbackRunnerUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const loopbackHost =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    url.protocol !== "http:" ||
    !loopbackHost ||
    !url.port ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url;
}

export function runnerSecretFromHash(hash: string) {
  const secret = new URLSearchParams(hash.replace(/^#/, "")).get("scout-runner");
  return secret && /^[A-Za-z0-9_-]{32,}$/.test(secret) ? secret : null;
}
