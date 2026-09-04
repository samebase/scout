import {
  docsToModelMessages,
  filterOutOrphanedToolMessages,
  type MessageDoc,
} from "@convex-dev/agent";
import type { ModelMessage } from "ai";
import type { PaginationResult } from "convex/server";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { compactBrowserModelContext } from "./browserContext";
import {
  compactionCut,
  estimateContextTokens,
  KEEP_RECENT_MESSAGES,
  summaryMessage,
} from "./modelContext";

export async function loadUncompactedMessages(
  ctx: Pick<ActionCtx, "runQuery">,
  args: {
    threadId: string;
    promptMessageId: string;
    compaction: Pick<Doc<"scoutCompactions">, "coveredThrough"> | null;
  },
) {
  const messages: MessageDoc[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: PaginationResult<MessageDoc> = await ctx.runQuery(
      components.agent.messages.listMessagesByThreadId,
      {
        threadId: args.threadId,
        upToAndIncludingMessageId: args.promptMessageId,
        order: "desc",
        statuses: ["success"],
        excludeToolMessages: false,
        paginationOpts: { cursor, numItems: 100, maximumBytesRead: 2_000_000 },
      },
    );
    for (const message of page.page) {
      const boundary = args.compaction?.coveredThrough;
      if (
        boundary &&
        (message.order < boundary.order ||
          (message.order === boundary.order && message.stepOrder <= boundary.stepOrder))
      ) {
        return messages.reverse();
      }
      messages.push(message);
    }
    if (page.isDone) return messages.reverse();
    cursor = page.continueCursor;
  }
}

export async function prepareConversationContext(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  args: {
    threadId: string;
    promptMessageId: string;
    threshold: number;
    fixedTokens: number;
    preserveObjective: (messages: ModelMessage[]) => ModelMessage[];
    summarize: (input: { previousSummary: string | null; messages: ModelMessage[] }) => Promise<{
      summary: string;
      modelCallId: Id<"scoutModelCalls">;
    }>;
  },
) {
  let compaction: Pick<
    Doc<"scoutCompactions">,
    "_id" | "summary" | "coveredThrough" | "coveredMessageCount"
  > | null = await ctx.runQuery(internal.scout.compactions.latest, { threadId: args.threadId });
  let entries = filterOutOrphanedToolMessages(
    await loadUncompactedMessages(ctx, { ...args, compaction }),
  ).flatMap((doc) => docsToModelMessages([doc]).map((message) => ({ doc, message })));
  const context = (summary: string | null, messages: ModelMessage[]) => {
    const recentStart = Math.max(0, messages.length - KEEP_RECENT_MESSAGES);
    return [
      ...(summary === null ? [] : [summaryMessage(summary)]),
      ...args.preserveObjective([
        ...compactBrowserModelContext(messages).slice(0, recentStart),
        ...messages.slice(recentStart),
      ]),
    ];
  };
  for (;;) {
    const messages = entries.map((entry) => entry.message);
    const current = context(compaction?.summary ?? null, messages);
    const beforeTokens = args.fixedTokens + estimateContextTokens(current);
    if (beforeTokens < args.threshold)
      return { messages: current, compactionId: compaction?._id ?? null };
    const cut = compactionCut(messages);
    // Avoid paying to summarize a tiny prefix, especially when fixed tool schemas
    // or the protected recent messages account for most of the context.
    if (
      cut === 0 ||
      estimateContextTokens(compactBrowserModelContext(messages).slice(0, cut)) < 2_000
    ) {
      return { messages: current, compactionId: compaction?._id ?? null };
    }
    const result = await args.summarize({
      previousSummary: compaction?.summary ?? null,
      messages: messages.slice(0, cut),
    });
    const remaining = entries.slice(cut);
    const afterTokens =
      args.fixedTokens +
      estimateContextTokens(
        context(
          result.summary,
          remaining.map((entry) => entry.message),
        ),
      );
    if (!result.summary.trim() || afterTokens >= beforeTokens) {
      throw new Error(
        "Conversation compaction did not produce a smaller nonempty summary; original history is unchanged",
      );
    }
    const boundary = entries[cut - 1].doc;
    const compactionId = await ctx.runMutation(internal.scout.compactions.save, {
      threadId: args.threadId,
      modelCallId: result.modelCallId,
      previousCompactionId: compaction?._id ?? null,
      summary: result.summary,
      coveredThrough: {
        messageId: boundary._id,
        order: boundary.order,
        stepOrder: boundary.stepOrder,
      },
      coveredMessageCount: (compaction?.coveredMessageCount ?? 0) + cut,
      beforeTokens,
      afterTokens,
    });
    compaction = {
      _id: compactionId,
      summary: result.summary,
      coveredThrough: {
        messageId: boundary._id,
        order: boundary.order,
        stepOrder: boundary.stepOrder,
      },
      coveredMessageCount: (compaction?.coveredMessageCount ?? 0) + cut,
    };
    entries = remaining;
  }
}
