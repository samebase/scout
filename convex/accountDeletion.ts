import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { WorkflowManager, vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { ConvexError, v } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { publicMutation, publicQuery } from "./functions";
import { requireViewerPermission } from "./access";
import { ACCOUNT_DELETION_CONFIRMATION } from "../shared/accountDeletion";
import { omitNullish } from "../shared/omitNullish";

const deletionWorkflow = new WorkflowManager(components.workflow);

export const status = publicQuery({
  access: "access_public",
  args: {},
  returns: v.union(
    v.object({ kind: v.literal("signed_out") }),
    v.object({ kind: v.literal("ready") }),
    v.object({ kind: v.literal("unavailable") }),
    v.object({ kind: v.literal("deleting") }),
    v.object({ kind: v.literal("failed") }),
    v.object({ kind: v.literal("deleted") }),
  ),
  handler: async (ctx) => {
    if (ctx.viewer.kind === "anonymous") return { kind: "signed_out" as const };
    if (ctx.viewer.kind === "account") return { kind: "ready" as const };
    if (ctx.viewer.kind === "unavailable") return { kind: "unavailable" as const };
    if (ctx.viewer.kind === "deleted") return { kind: "deleted" as const };
    const userId = await getAuthUserId(ctx);
    const user = userId && (await ctx.db.get(userId));
    if (!user || user.state !== "deleting") throw new Error("Deleting account is missing");
    const job = await deletionWorkflow.status(ctx, user.workflowId);
    return {
      kind:
        job.type === "failed" || job.type === "canceled"
          ? ("failed" as const)
          : ("deleting" as const),
    };
  },
});

export const request = publicMutation({
  access: "access_public",
  args: { confirmation: v.string() },
  returns: v.null(),
  handler: async (ctx, { confirmation }): Promise<null> => {
    if (confirmation !== ACCOUNT_DELETION_CONFIRMATION)
      throw new ConvexError(`Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm`);
    if (ctx.viewer.kind === "deleting" || ctx.viewer.kind === "deleted") return null;
    const { userId } = requireViewerPermission(ctx.viewer, "access_account");
    const sessionId = await getAuthSessionId(ctx);
    const session = sessionId && (await ctx.db.get("authSessions", sessionId));
    if (!session || session.userId !== userId || session.expirationTime <= Date.now())
      throw new ConvexError("Sign in again before deleting your account");
    const workflowId = await deletionWorkflow.start(
      ctx,
      internal.accountDeletion.run,
      { userId, sessionId: session._id },
      { startAsync: true, onComplete: internal.accountDeletion.onComplete, context: null },
    );
    await ctx.db.patch("users", userId, { state: "deleting", workflowId });
    return null;
  },
});

export const retry = publicMutation({
  access: "access_public",
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const userId = await getAuthUserId(ctx);
    const user = userId && (await ctx.db.get("users", userId));
    if (!user || user.state !== "deleting") throw new ConvexError("Not authorized");
    const job = await deletionWorkflow.status(ctx, user.workflowId);
    if (job.type === "failed" || job.type === "canceled")
      await deletionWorkflow.restart(ctx, user.workflowId, { from: 0, startAsync: true });
    return null;
  },
});

export const run = deletionWorkflow
  .define({
    args: { userId: v.id("users"), sessionId: v.id("authSessions") },
    returns: v.null(),
  })
  .handler(async (step, { userId, sessionId }): Promise<null> => {
    while (
      !(await step.runMutation(internal.accountDeletionCleanup.authBatch, {
        userId,
        sessionId,
        phase: "other_sessions",
      }))
    ) {
      /* Continue bounded cleanup. */
    }

    let cursor: string | null = null;
    while (true) {
      const page: FunctionReturnType<typeof internal.accountDeletionCleanup.chats> =
        await step.runQuery(internal.accountDeletionCleanup.chats, { userId, cursor });
      for (const threadId of page.threadIds) {
        while (true) {
          const chat = await step.runMutation(internal.accountDeletionCleanup.stopChat, {
            userId,
            threadId,
          });
          if (chat.kind === "ready") break;
          if (chat.kind === "waiting") {
            await step.sleep(2_000);
          } else {
            await step.runAction(internal.humanHandoffBrowser.finishBrowserSession, {
              sessionId: chat.sessionId,
              captureEvidence: false,
              ...omitNullish({ usageTurnId: chat.turnId }),
            });
          }
        }
      }
      if (page.isDone) break;
      cursor = page.cursor;
    }
    while (
      !(await step.runMutation(internal.accountDeletionCleanup.authBatch, {
        userId,
        sessionId,
        phase: "accounts",
      }))
    ) {
      /* Continue bounded cleanup. */
    }
    while (
      !(await step.runMutation(internal.accountDeletionCleanup.finish, {
        userId,
        sessionId,
      }))
    ) {
      /* Continue bounded cleanup. */
    }
    return null;
  });

export const onComplete = internalMutation({
  args: { workflowId: vWorkflowId, result: vResultValidator, context: v.null() },
  returns: v.null(),
  handler: async (ctx, { workflowId, result }) => {
    if (result.kind === "success") await deletionWorkflow.cleanup(ctx, workflowId);
    return null;
  },
});
