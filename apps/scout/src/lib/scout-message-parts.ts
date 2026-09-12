import { z } from "zod";

const toolInvocationFields = {
  toolCallId: z.string(),
  callProviderMetadata: z.unknown().optional(),
};

const toolInvocationSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("input-streaming"),
    ...toolInvocationFields,
    input: z.unknown().optional(),
  }),
  z.object({
    state: z.literal("input-available"),
    ...toolInvocationFields,
    input: z.unknown(),
  }),
  z.object({
    state: z.literal("approval-requested"),
    ...toolInvocationFields,
    input: z.unknown(),
  }),
  z.object({
    state: z.literal("approval-responded"),
    ...toolInvocationFields,
    input: z.unknown(),
  }),
  z.object({
    state: z.literal("output-available"),
    ...toolInvocationFields,
    input: z.unknown(),
    output: z.unknown(),
  }),
  z.object({
    state: z.literal("output-error"),
    ...toolInvocationFields,
    input: z.unknown().optional(),
    errorText: z.string(),
  }),
  z.object({
    state: z.literal("output-denied"),
    ...toolInvocationFields,
    input: z.unknown(),
  }),
]);

const toolIdentitySchema = z.union([
  z
    .object({ type: z.literal("dynamic-tool"), toolName: z.string().min(1) })
    .transform(({ toolName }) => ({ name: toolName })),
  z
    .object({ type: z.string().regex(/^tool-.+/) })
    .transform(({ type }) => ({ name: type.slice("tool-".length) })),
]);
const sourceUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
});

const basicMessagePartSchema = z.union([
  z
    .object({ type: z.literal("text"), text: z.string() })
    .transform(({ text }) => ({ kind: "text" as const, text })),
  z
    .object({ type: z.literal("reasoning"), id: z.string().optional(), text: z.string() })
    .transform(({ id, text }) => ({ kind: "reasoning" as const, id, text })),
  z
    .object({
      type: z.literal("source-url"),
      sourceId: z.string(),
      url: sourceUrlSchema,
      title: z.string().optional(),
    })
    .transform(({ sourceId, title, url }) => ({
      kind: "source" as const,
      id: sourceId,
      url,
      title: title ?? url,
    })),
  z.object({ type: z.literal("step-start") }).transform(() => ({ kind: "step" as const })),
]);

const typedMessagePartSchema = z.object({ type: z.string() });
const browserExecuteInputSchema = z.object({ code: z.string() });
const repairMetadataSchema = z.object({
  callProviderMetadata: z.object({
    scout: z.object({
      inputRepair: z.object({
        method: z.literal("json-parse"),
        fields: z.array(z.string()),
      }),
    }),
  }),
});
const structuredToolFailureSchema = z.union([
  z.object({ success: z.literal(false) }),
  z.object({ isError: z.literal(true) }),
]);

type BasicMessagePart = z.output<typeof basicMessagePartSchema>;

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function toolOutputFailure(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") {
    const message = value.trim();
    return /^(?:[A-Za-z_$][\w$]*Error|Error):/.test(message) ||
      /^An error occurred\.?$/i.test(message)
      ? value
      : undefined;
  }
  return structuredToolFailureSchema.safeParse(value).success ? formatValue(value) : undefined;
}

export function repairedToolInputFields(value: unknown) {
  const parsed = repairMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data.callProviderMetadata.scout.inputRepair.fields : [];
}

export function toolInputPreview(toolName: string, input: unknown) {
  if (input === undefined) return undefined;
  const browserInput = browserExecuteInputSchema.safeParse(input);
  const preview =
    toolName === "browser_execute" && browserInput.success
      ? browserInput.data.code
      : formatValue(input);
  const trimmed = preview.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toolActivity(value: unknown) {
  const identity = toolIdentitySchema.safeParse(value);
  const invocation = toolInvocationSchema.safeParse(value);
  if (!identity.success || !invocation.success) return null;

  const input = invocation.data.input;
  const output = invocation.data.state === "output-available" ? invocation.data.output : undefined;
  const outputFailure = output === undefined ? undefined : toolOutputFailure(output);
  const error =
    invocation.data.state === "output-error" ? invocation.data.errorText : outputFailure;

  return {
    name: identity.data.name,
    state: invocation.data.state,
    toolCallId: invocation.data.toolCallId,
    input: input === undefined ? undefined : formatValue(input),
    inputPreview: toolInputPreview(identity.data.name, input),
    output: output === undefined || outputFailure !== undefined ? undefined : formatValue(output),
    error,
    repairedInputFields: repairedToolInputFields(value),
  };
}

export type ScoutToolActivity = NonNullable<ReturnType<typeof toolActivity>>;

export type ScoutMessagePart =
  | BasicMessagePart
  | { kind: "tool"; tool: ScoutToolActivity }
  | { kind: "unsupported"; label: string };

export function parseScoutMessagePart(value: unknown): ScoutMessagePart {
  const basicPart = basicMessagePartSchema.safeParse(value);
  if (basicPart.success) return basicPart.data;

  const tool = toolActivity(value);
  if (tool) return { kind: "tool", tool };

  const typedPart = typedMessagePartSchema.safeParse(value);
  return {
    kind: "unsupported",
    label: typedPart.success
      ? typedPart.data.type.replaceAll("-", " ")
      : "Unrecognized message part",
  };
}

export function parseScoutMessageParts(parts: readonly unknown[]): ScoutMessagePart[] {
  return parts.map(parseScoutMessagePart);
}

export function countGenerationSteps(parts: readonly ScoutMessagePart[]) {
  return parts.reduce((count, part) => count + (part.kind === "step" ? 1 : 0), 0);
}
