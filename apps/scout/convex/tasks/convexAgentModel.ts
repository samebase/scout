import {
  docsToModelMessages,
  filterOutOrphanedToolMessages,
  type MessageDoc,
} from "@convex-dev/agent";
import { vToolResultOutput } from "@convex-dev/agent/validators";
import type { LanguageModelUsage, ModelMessage } from "ai";
import { validate } from "convex-helpers/validators";
import { type Infer, v } from "convex/values";
import { z } from "zod";
import { compactBrowserModelContext } from "../scout/browserContext";
import type { taskToolCallSchema } from "../../shared/taskTranscript";
import type { callResult, sessionItem } from "./model";
import { compactionCut, estimateContextTokens, summaryMessage } from "../scout/modelContext";

export const convexUsage = v.object({
  inputTokens: v.number(),
  outputTokens: v.number(),
  cachedInputTokens: v.union(v.number(), v.null()),
  reasoningTokens: v.union(v.number(), v.null()),
  costUsd: v.union(v.number(), v.null()),
});
const contextBoundary = v.object({
  messageId: v.string(),
  order: v.number(),
  stepOrder: v.number(),
});
export const convexContextRecord = v.object({
  sessionId: v.id("agentsApiSessions"),
  summary: v.string(),
  coveredThrough: contextBoundary,
  usage: v.union(convexUsage, v.null()),
});
export const zeroUsage: Infer<typeof convexUsage> = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
};

export function addUsage(
  left: Infer<typeof convexUsage> | null,
  right: Infer<typeof convexUsage> | null,
): Infer<typeof convexUsage> | null {
  if (left === null || right === null) return null;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedInputTokens:
      left.cachedInputTokens === null || right.cachedInputTokens === null
        ? null
        : left.cachedInputTokens + right.cachedInputTokens,
    reasoningTokens:
      left.reasoningTokens === null || right.reasoningTokens === null
        ? null
        : left.reasoningTokens + right.reasoningTokens,
    costUsd: left.costUsd === null || right.costUsd === null ? null : left.costUsd + right.costUsd,
  };
}

export function generationUsage(usage: LanguageModelUsage): Infer<typeof convexUsage> | null {
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  const cost: unknown = usage.raw?.["cost"];
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? null,
    costUsd: typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}

export type CompletedCall = Exclude<Infer<typeof callResult>, { kind: "running" }>;

export function modelToolOutput(result: CompletedCall): Infer<typeof vToolResultOutput> {
  switch (result.kind) {
    case "error":
    case "interrupted":
      return { type: "error-text", value: result.error };
    case "success": {
      const value = z.json().parse(JSON.parse(result.output));
      return validate(vToolResultOutput, value) ? value : { type: "json", value };
    }
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export function toolCallItem(call: {
  callId: string;
  name: string;
  arguments: unknown;
}): Infer<typeof sessionItem> {
  const details = {
    callId: call.callId,
    name: call.name,
    input: z.json().parse(call.arguments),
  } satisfies z.infer<typeof taskToolCallSchema>;
  return {
    providerItemId: `convex:tool:${call.callId}`,
    kind: "tool_call",
    text: call.name,
    details: JSON.stringify(details),
    complete: true,
  };
}

export function textItem(
  messageId: string,
  kind: "user" | "assistant" | "reasoning",
  text: string,
  complete: boolean,
): Infer<typeof sessionItem> {
  return {
    providerItemId: `convex:${messageId}:${kind}`,
    kind,
    text,
    details: JSON.stringify({ engine: "convex_agent", messageId, type: kind, text }),
    complete,
  };
}

export function projectMessage(doc: MessageDoc): Infer<typeof sessionItem>[] {
  const message = doc.message;
  if (!message || message.role === "tool" || message.role === "system") return [];
  const complete = doc.status !== "pending";
  if (typeof message.content === "string")
    return [textItem(doc._id, message.role, message.content, complete)];
  const items: Infer<typeof sessionItem>[] = [];
  const reasoning = message.content
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("");
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  if (reasoning) items.push(textItem(doc._id, "reasoning", reasoning, complete));
  if (text) items.push(textItem(doc._id, message.role, text, complete));
  for (const part of message.content) {
    if (part.type === "tool-call")
      items.push(
        toolCallItem({ callId: part.toolCallId, name: part.toolName, arguments: part.input }),
      );
  }
  return items;
}

export function pendingToolCalls(messages: MessageDoc[]) {
  const completed = new Set<string>();
  const calls: { callId: string; name: string; arguments: unknown }[] = [];
  for (const doc of messages) {
    if (doc.status !== "success" || !doc.message || typeof doc.message.content === "string")
      continue;
    for (const part of doc.message.content) {
      if (part.type === "tool-result") completed.add(part.toolCallId);
      if (part.type === "tool-call")
        calls.push({ callId: part.toolCallId, name: part.toolName, arguments: part.input });
    }
  }
  return calls.filter((call) => !completed.has(call.callId));
}

export function modelContext(messages: ModelMessage[], prompt: MessageDoc) {
  const [objective] = docsToModelMessages([prompt]);
  if (!objective) throw new Error("Convex Agent objective is missing");
  const hasObjective = messages.some(
    (message) =>
      message.role === "user" &&
      JSON.stringify(message.content) === JSON.stringify(objective.content),
  );
  return hasObjective ? messages : [objective, ...messages];
}

export function prepareContext(
  messages: MessageDoc[],
  prompt: MessageDoc,
  context: Infer<typeof convexContextRecord> | null,
  fixedTokens: number,
  threshold: number,
) {
  const entries = messages
    .filter(
      (doc) =>
        doc.status === "success" &&
        (!context ||
          doc.order > context.coveredThrough.order ||
          (doc.order === context.coveredThrough.order &&
            doc.stepOrder > context.coveredThrough.stepOrder)),
    )
    .flatMap((doc) => docsToModelMessages([doc]).map((message) => ({ doc, message })));
  const assemble = (summary: string | null, selected: typeof entries) => {
    const all = docsToModelMessages(
      filterOutOrphanedToolMessages(selected.map((entry) => entry.doc)),
    );
    return [
      ...(summary === null ? [] : [summaryMessage(summary)]),
      ...modelContext(compactBrowserModelContext(all), prompt),
    ];
  };
  const prepared = assemble(context?.summary ?? null, entries);
  const beforeTokens = fixedTokens + estimateContextTokens(prepared);
  if (beforeTokens < threshold) return { kind: "ready", messages: prepared } as const;
  const compacted = compactBrowserModelContext(entries.map((entry) => entry.message));
  const cut = compactionCut(compacted);
  if (!cut)
    throw new Error("Task context exceeds its budget with no complete older exchange to summarize");
  const boundary = entries[cut - 1]?.doc;
  if (!boundary) throw new Error("Compaction boundary is missing");
  return {
    kind: "compact",
    input: { previousSummary: context?.summary ?? null, messages: compacted.slice(0, cut) },
    coveredThrough: {
      messageId: boundary._id,
      order: boundary.order,
      stepOrder: boundary.stepOrder,
    },
    validateSummary(summary: string) {
      if (
        !summary.trim() ||
        fixedTokens + estimateContextTokens(assemble(summary, entries.slice(cut))) >= beforeTokens
      )
        throw new Error(
          "Conversation compaction did not produce a smaller nonempty summary; original history is unchanged",
        );
    },
  } as const;
}

export function accumulatedUsage(messages: MessageDoc[]) {
  const generated = messages.filter(
    (doc) => doc.message?.role === "assistant" && doc.status !== "pending",
  );
  let incomplete = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens: number | null = 0;
  let reasoningTokens: number | null = 0;
  let costUsd: number | null = 0;
  for (const doc of generated) {
    const usage = doc.usage;
    if (usage?.promptTokens === undefined || usage.completionTokens === undefined) {
      incomplete = true;
      continue;
    }
    inputTokens += usage.promptTokens;
    outputTokens += usage.completionTokens;
    cachedInputTokens =
      cachedInputTokens === null || usage.cachedInputTokens === undefined
        ? null
        : cachedInputTokens + usage.cachedInputTokens;
    reasoningTokens =
      reasoningTokens === null || usage.reasoningTokens === undefined
        ? null
        : reasoningTokens + usage.reasoningTokens;
    const rawCost: unknown = usage.raw?.["cost"];
    costUsd =
      costUsd !== null && typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0
        ? costUsd + rawCost
        : null;
  }
  return {
    usage: { inputTokens, outputTokens, cachedInputTokens, reasoningTokens, costUsd },
    incomplete,
  };
}
