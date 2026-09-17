import type { MessageDoc } from "@convex-dev/agent";
import type { PaginationResult } from "convex/server";
import type { ToolActivity } from "../../shared/toolActivity";
import { components } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import { parseToolValue, presentToolActivity } from "./toolActivity";

type Assistant = Extract<NonNullable<MessageDoc["message"]>, { role: "assistant" }>;
type Call = Extract<Exclude<Assistant["content"], string>[number], { type: "tool-call" }>;
type Result = Extract<
  Extract<NonNullable<MessageDoc["message"]>, { role: "tool" }>["content"][number],
  { type: "tool-result" }
>;

function convexToolCalls(message: MessageDoc): Call[] {
  const content = message.message;
  if (content?.role !== "assistant" || typeof content.content === "string") return [];
  return content.content.filter((part) => part.type === "tool-call");
}

export async function convexToolActivities(ctx: QueryCtx, messages: MessageDoc[]) {
  const activities = new Map<string, ToolActivity[]>();
  const groups = new Map<number, MessageDoc[]>();
  for (const message of messages) {
    if (convexToolCalls(message).length === 0) continue;
    const group = groups.get(message.order) ?? [];
    group.push(message);
    groups.set(message.order, group);
  }
  // The component has no call-ID index. Read only the relevant turn's tail,
  // stopping at the earliest requested call, never collecting the transcript.
  let remainingRows = 512;
  let remainingBytes = 4_000_000;
  for (const [order, group] of groups) {
    const anchor = group[0];
    if (!anchor) continue;
    const earliestStep = Math.min(...group.map((message) => message.stepOrder));
    const wanted = new Set(group.flatMap(convexToolCalls).map((call) => call.toolCallId));
    const results = new Map<string, Result>();
    for (const message of messages) {
      if (message.order !== order || message.message?.role !== "tool") continue;
      for (const part of message.message.content) {
        if (
          part.type === "tool-result" &&
          wanted.has(part.toolCallId) &&
          !results.has(part.toolCallId)
        )
          results.set(part.toolCallId, part);
      }
    }
    let cursor: string | null = null;
    // Only the newest turn in this page can have results on an earlier page.
    // For older turns this page already includes every step after the calls.
    while (order === messages[0]?.order && results.size < wanted.size) {
      if (remainingRows <= 0 || remainingBytes <= 0)
        throw new Error(
          "Tool activity pairing exceeds the read limit for this page: 512 messages or 4 MB.",
        );
      const page: PaginationResult<MessageDoc> = await ctx.runQuery(
        components.agent.messages.listMessagesByThreadId,
        {
          threadId: anchor.threadId,
          upToAndIncludingMessageId: anchor._id,
          order: "desc",
          paginationOpts: {
            cursor,
            numItems: Math.min(64, remainingRows),
            maximumRowsRead: remainingRows,
            maximumBytesRead: Math.min(1_000_000, remainingBytes),
          },
        },
      );
      remainingRows -= Math.max(page.page.length, 1);
      remainingBytes -= new TextEncoder().encode(JSON.stringify(page.page)).length;
      let reachedCall = false;
      for (const message of page.page) {
        if (message.order < order || (message.order === order && message.stepOrder <= earliestStep))
          reachedCall = true;
        if (message.order !== order || message.message?.role !== "tool") continue;
        for (const part of message.message.content) {
          if (
            part.type === "tool-result" &&
            wanted.has(part.toolCallId) &&
            !results.has(part.toolCallId)
          )
            results.set(part.toolCallId, part);
        }
      }
      if (results.size === wanted.size || reachedCall || page.isDone) break;
      cursor = page.continueCursor;
    }
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_thread_id_and_order", (q) =>
        q.eq("threadId", anchor.threadId).eq("order", order),
      )
      .unique();
    for (const message of group) {
      activities.set(
        message._id,
        convexToolCalls(message).map((call) => {
          const result = results.get(call.toolCallId);
          const output = result ? parseToolValue(result.output ?? result.result ?? null) : null;
          const state = result
            ? result.isError
              ? "failed"
              : "completed"
            : message.status === "failed"
              ? "failed"
              : turn?.state.kind === "pending"
                ? "running"
                : "interrupted";
          return presentToolActivity({
            id: `${message._id}:${call.toolCallId}`,
            name: call.toolName,
            state,
            input: parseToolValue(call.args),
            output,
            error: result?.isError
              ? typeof output === "string"
                ? output
                : JSON.stringify(output)
              : null,
            audience: "member",
          });
        }),
      );
    }
  }
  return activities;
}
