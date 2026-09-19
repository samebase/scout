import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { requireSessionPermission } from "./access";
import { handoffAccess, handoffPage } from "./handoffModel";
import { currentCheckMessage } from "./requestChecks";
import { resumeHandoff } from "./sessions";
import { requireFirecrawlLiveViewUrl } from "../scout/lib/firecrawlLiveView";

const accessArgs = { sessionId: v.string(), tokenHash: v.string() };

async function authorizedSession(ctx: MutationCtx, args: { sessionId: string; tokenHash: string }) {
  const sessionId = ctx.db.normalizeId("agentsApiSessions", args.sessionId);
  const session = sessionId ? await ctx.db.get(sessionId) : null;
  if (!session?.handoffAccess || session.handoffAccess.tokenHash !== args.tokenHash) return null;
  await requireSessionPermission(ctx, session);
  return { session, access: session.handoffAccess };
}

async function page(
  ctx: MutationCtx,
  authorized: Awaited<ReturnType<typeof authorizedSession>>,
): Promise<Infer<typeof handoffPage>> {
  if (!authorized) return { status: "invalid" };
  const { session, access } = authorized;
  const state = session.state;
  if (state.kind === "stopped")
    return { status: state.reason === "handoff_expired" ? "expired" : "stopped" };
  if (state.kind === "failed")
    return { status: "failed", error: state.error, diagnostic: state.diagnostic ?? null };
  const active = {
    scoutName: session.scoutName,
    expiresAt: access.expiresAt,
  };
  switch (state.kind) {
    case "waiting": {
      if (
        state.callId !== access.callId ||
        state.turnId !== access.turnId ||
        state.expiresAt !== access.expiresAt
      )
        return { status: "invalid" };
      if (Date.now() >= access.expiresAt) {
        await ctx.runMutation(internal.tasks.sessions.expireHandoff, {
          sessionId: session._id,
          callId: access.callId,
          turnId: access.turnId,
          expiresAt: access.expiresAt,
        });
        return { status: "expired" };
      }
      if (
        !session.active ||
        !session.browser?.interactiveLiveViewUrl ||
        session.browser.providerSessionId !== access.providerSessionId
      )
        return { status: "stopped" };
      return {
        status: "waiting",
        ...active,
        message: state.message,
        interactiveLiveViewUrl: requireFirecrawlLiveViewUrl(session.browser.interactiveLiveViewUrl),
        checkMessage: await currentCheckMessage(ctx, session),
      };
    }
    case "checking": {
      const check = await ctx.db.get(state.checkId);
      if (
        !session.active ||
        check?.kind !== "resume" ||
        check.sessionId !== session._id ||
        check.handoff.callId !== access.callId ||
        check.handoff.turnId !== access.turnId ||
        check.handoff.expiresAt !== access.expiresAt ||
        check.providerSessionId !== access.providerSessionId
      )
        return { status: "invalid" };
      return { status: "checking", ...active };
    }
    case "running":
    case "idle": {
      // Agents API releases the check before submission; call success confirms delivery.
      const call = await ctx.db
        .query("agentsApiCalls")
        .withIndex("by_session_id_and_call_id", (q) =>
          q.eq("sessionId", session._id).eq("callId", access.callId),
        )
        .unique();
      return call?.result.kind === "success"
        ? { status: "continued", scoutName: session.scoutName }
        : { status: "checking", ...active };
    }
    case "starting":
      return { status: "invalid" };
  }
}

export const issue = internalMutation({
  args: { sessionId: v.id("agentsApiSessions"), access: handoffAccess },
  returns: v.boolean(),
  handler: async (ctx, { sessionId, access }): Promise<boolean> => {
    const session = await ctx.db.get(sessionId);
    if (
      !session?.active ||
      session.state.kind !== "waiting" ||
      session.state.callId !== access.callId ||
      session.state.turnId !== access.turnId ||
      session.state.expiresAt !== access.expiresAt ||
      access.expiresAt <= Date.now() ||
      session.browser?.providerSessionId !== access.providerSessionId
    )
      return false;
    await requireSessionPermission(ctx, session);
    await ctx.db.patch(sessionId, { handoffAccess: access });
    return true;
  },
});

export const load = internalMutation({
  args: accessArgs,
  returns: handoffPage,
  handler: async (ctx, args): Promise<Infer<typeof handoffPage>> =>
    await page(ctx, await authorizedSession(ctx, args)),
});

export const resume = internalMutation({
  args: accessArgs,
  returns: handoffPage,
  handler: async (ctx, args): Promise<Infer<typeof handoffPage>> => {
    const authorized = await authorizedSession(ctx, args);
    const current = await page(ctx, authorized);
    if (current.status !== "waiting" || !authorized) return current;
    await resumeHandoff(ctx, authorized.session, {
      sessionId: authorized.session._id,
      callId: authorized.access.callId,
      turnId: authorized.access.turnId,
    });
    return await page(ctx, await authorizedSession(ctx, args));
  },
});
