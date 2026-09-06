import { v } from "convex/values";
import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { readUserAccess } from "./access";
import { canAccess } from "../shared/accessModel";
import { MAX_BROWSER_SESSIONS_PER_THREAD } from "./scout/browserSessions";
import { omitNullish } from "../shared/omitNullish";
import { stopHumanHandoffForTurn } from "./humanHandoffsModel";
import { stopTurn, continueStoppingTurn } from "./scout/turns";
import { scoutTurnWorkflow } from "./scout/turnWorkflow";

export const cleanupChats = internalMutation({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await readUserAccess(ctx, args.userId);
    if (access.kind === "account" && canAccess("access_lab", access.accessKeys)) return null;
    const batch = await ctx.db
      .query("scoutChats")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .paginate({ numItems: 1, cursor: args.cursor });
    for (const chat of batch.page) {
      const turn = await ctx.db
        .query("scoutTurns")
        .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", chat.threadId))
        .order("desc")
        .first();
      if (turn) {
        await stopHumanHandoffForTurn(ctx, turn._id);
        switch (turn.state.kind) {
          case "pending":
            await stopTurn(ctx, turn);
            break;
          case "stopping": {
            const { replacement: _replacement, ...state } = turn.state;
            await ctx.db.patch(turn._id, { state });
            await continueStoppingTurn(ctx, turn._id);
            break;
          }
          case "replacing":
            await ctx.db.patch(turn._id, {
              state: {
                kind: "stopped",
                stoppedAt: Date.now(),
                usage: turn.state.usage,
                ...omitNullish({
                  firecrawlCredits: turn.state.firecrawlCredits,
                  firecrawlDurationMs: turn.state.firecrawlDurationMs,
                }),
              },
            });
            break;
          case "completed":
          case "failed":
          case "stopped":
            break;
          default:
            turn.state satisfies never;
        }
      }
      const sessions = await ctx.db
        .query("scoutBrowserSessions")
        .withIndex("by_thread_id_and_sequence", (q) => q.eq("threadId", chat.threadId))
        .take(MAX_BROWSER_SESSIONS_PER_THREAD);
      for (const session of sessions) {
        if (session.lifecycle.kind !== "active") continue;
        await ctx.db.patch(session._id, {
          lifecycle: { ...session.lifecycle, kind: "closing", closingAtMs: Date.now() },
        });
        await scoutTurnWorkflow.start(
          ctx,
          internal.accountRevocation.closeBrowser,
          { sessionId: session._id, turnId: turn?._id ?? null },
          {
            startAsync: true,
            onComplete: internal.accountRevocation.onBrowserClosed,
            context: null,
          },
        );
      }
    }
    if (!batch.isDone)
      await ctx.scheduler.runAfter(0, internal.accountRevocation.cleanupChats, {
        userId: args.userId,
        cursor: batch.continueCursor,
      });
    return null;
  },
});

export const closeBrowser = scoutTurnWorkflow
  .define({
    args: {
      sessionId: v.id("scoutBrowserSessions"),
      turnId: v.union(v.id("scoutTurns"), v.null()),
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    await step.runAction(
      internal.humanHandoffBrowser.finishBrowserSession,
      {
        sessionId: args.sessionId,
        captureEvidence: false,
        ...omitNullish({ usageTurnId: args.turnId }),
      },
      { retry: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 } },
    );
    return null;
  });

export const onBrowserClosed = internalMutation({
  args: { workflowId: vWorkflowId, result: vResultValidator, context: v.null() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Retain exhausted failures in the workflow component for operator inspection and retry.
    if (args.result.kind === "success") await scoutTurnWorkflow.cleanup(ctx, args.workflowId);
    return null;
  },
});
