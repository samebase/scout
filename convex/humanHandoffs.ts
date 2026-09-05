import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getAppUserId, requireAppUser } from "./access";
import {
  chatHumanHandoffValidator,
  expiredHandoff,
  failedHandoff,
  handoffClaim,
  handoffCommon,
  handoffDeadline,
  requestedHumanHandoffValidator,
  signalHumanHandoffOutcome,
  humanHandoffDestinationValidator,
  humanHandoffFailureValidator,
  humanHandoffPageValidator,
  humanHandoffStatusValidator,
} from "./humanHandoffsModel";
import { humanHandoffDeliveryArgsValidator } from "./humanHandoffDeliveryModel";
import { humanHandoffWorkflow } from "./humanHandoffWorkflow";
import { humanHandoffInputSchema } from "./scout/humanHandoffInput";

export const HUMAN_HANDOFF_CLAIM_MS = 45 * 60 * 1_000;
export const HUMAN_HANDOFF_ACTIVE_MS = 5 * 60 * 1_000;
const HUMAN_HANDOFF_ACCESS_GRACE_MS = 10 * 60 * 1_000;
const MAX_HANDOFF_REASON_LENGTH = 500;
const ACCESS_TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

type AccessArgs = { handoffId: string; accessTokenHash?: string };
type DatabaseCtx = Pick<QueryCtx, "auth" | "db">;

const accessArgsValidator = {
  handoffId: v.string(),
  accessTokenHash: v.optional(v.string()),
};

const pageContextFields = {
  handoffId: v.id("scoutHumanHandoffs"),
  reason: v.string(),
  scoutName: v.string(),
  destination: v.optional(humanHandoffDestinationValidator),
};

const preparedAccessValidator = v.union(
  v.object({ status: v.literal("invalid") }),
  v.object({ status: v.literal("due"), handoffId: v.id("scoutHumanHandoffs") }),
  v.object({ status: v.literal("broken"), handoffId: v.id("scoutHumanHandoffs") }),
  v.object({
    status: v.literal("available"),
    ...pageContextFields,
    claimExpiresAt: v.number(),
    interactiveLiveViewUrl: v.string(),
  }),
  v.object({
    status: v.literal("active"),
    ...pageContextFields,
    expiresAt: v.number(),
    interactiveLiveViewUrl: v.string(),
  }),
  v.object({
    status: v.literal("continued"),
    ...pageContextFields,
    continuedAt: v.number(),
  }),
  v.object({
    status: v.literal("expired"),
    ...pageContextFields,
    expiredAt: v.number(),
    claimed: v.boolean(),
  }),
  v.object({
    status: v.literal("stopped"),
    ...pageContextFields,
    stoppedAt: v.number(),
  }),
  v.object({
    status: v.literal("failed"),
    ...pageContextFields,
    failedAt: v.number(),
    failure: humanHandoffFailureValidator,
  }),
);

const preparedDeliveryValidator = v.union(
  v.object({
    kind: v.literal("ready"),
    claimExpiresAt: v.number(),
    promptMessageId: v.string(),
    accessTokenHash: v.string(),
    inboxId: v.string(),
    recipientEmail: v.string(),
    scoutName: v.string(),
  }),
  v.object({ kind: v.literal("definitive_failure") }),
  v.object({ kind: v.literal("skipped") }),
);

function boundedReason(value: string) {
  const reason = value.trim().replaceAll(/\s+/g, " ");
  if (!reason) throw new Error("Human help reason cannot be empty");
  if (Array.from(reason).length > MAX_HANDOFF_REASON_LENGTH) {
    throw new Error(`Human help reason must be ${MAX_HANDOFF_REASON_LENGTH} characters or fewer`);
  }
  return reason;
}

function accessTokenHash(value: string) {
  if (!ACCESS_TOKEN_HASH_PATTERN.test(value)) {
    throw new Error("Human handoff access token hash is invalid");
  }
  return value;
}

async function handoffContext(ctx: Pick<QueryCtx, "db">, handoff: Doc<"scoutHumanHandoffs">) {
  const session = await ctx.db.get("scoutBrowserSessions", handoff.sessionId);
  const chat = session
    ? await ctx.db
        .query("scoutChats")
        .withIndex("by_thread_id", (index) => index.eq("threadId", session.threadId))
        .unique()
    : null;
  const turn = await ctx.db.get("scoutTurns", handoff.turnId);
  if (
    !session ||
    !chat ||
    !turn ||
    chat.threadId !== turn.threadId ||
    chat.scoutId !== turn.scoutId ||
    session.scoutId !== chat.scoutId
  ) {
    return null;
  }
  return { session, chat, turn };
}

function resourcesAreUnavailable(
  context: NonNullable<Awaited<ReturnType<typeof handoffContext>>>,
  now: number,
) {
  return (
    context.turn.state.kind === "failed" ||
    context.turn.state.kind === "stopping" ||
    context.turn.state.kind === "replacing" ||
    context.turn.state.kind === "stopped" ||
    context.session.lifecycle.kind !== "active" ||
    context.session.lifecycle.providerExpiresAtMs <= now
  );
}

async function authorizedHandoff(ctx: DatabaseCtx, args: AccessArgs, now: number) {
  const handoffId = ctx.db.normalizeId("scoutHumanHandoffs", args.handoffId);
  if (!handoffId) return null;
  const handoff = await ctx.db.get("scoutHumanHandoffs", handoffId);
  if (!handoff) return null;
  const context = await handoffContext(ctx, handoff);
  if (!context) return null;
  const userId = await getAppUserId(ctx);
  const ownerAuthorized = userId === context.chat.userId;
  const bearerAuthorized =
    args.accessTokenHash !== undefined &&
    ACCESS_TOKEN_HASH_PATTERN.test(args.accessTokenHash) &&
    handoffDeadline(handoff) + HUMAN_HANDOFF_ACCESS_GRACE_MS > now &&
    handoff.accessTokenHash === args.accessTokenHash;
  return ownerAuthorized || bearerAuthorized ? { handoff, ownerAuthorized } : null;
}

async function pageContext(
  ctx: Pick<QueryCtx, "db">,
  handoff: Doc<"scoutHumanHandoffs">,
  ownerAuthorized: boolean,
) {
  const context = await handoffContext(ctx, handoff);
  if (!context) return null;
  const scout = await ctx.db.get("scouts", context.chat.scoutId);
  if (!scout) return null;
  return {
    handoffId: handoff._id,
    reason: handoff.reason,
    scoutName: scout.displayName,
    ...(ownerAuthorized
      ? {
          destination: {
            threadId: context.chat.threadId,
          },
        }
      : {}),
  };
}

async function terminalPage(
  ctx: Pick<QueryCtx, "db">,
  handoff: Doc<"scoutHumanHandoffs">,
  ownerAuthorized: boolean,
) {
  const context = await pageContext(ctx, handoff, ownerAuthorized);
  if (!context) return { status: "invalid" as const };
  switch (handoff.status) {
    case "available":
    case "active":
      throw new Error("Active handoff is not terminal");
    case "continued":
    case "resumed":
      return { ...context, status: "continued" as const, continuedAt: handoff.continuedAt };
    case "stopped":
      return { ...context, status: "stopped" as const, stoppedAt: handoff.stoppedAt };
    case "expired":
      return {
        ...context,
        status: "expired" as const,
        expiredAt: handoff.expiredAt,
        claimed: handoff.claimed,
      };
    case "failed":
      return {
        ...context,
        status: "failed" as const,
        failedAt: handoff.failedAt,
        failure: handoff.failure,
      };
  }
}

function requestResult(args: {
  handoff: Extract<Doc<"scoutHumanHandoffs">, { status: "available" }>;
  created: boolean;
  recipientEmail: string;
  scoutName: string;
}) {
  return {
    handoffId: args.handoff._id,
    created: args.created,
    recipientEmail: args.recipientEmail,
    scoutName: args.scoutName,
    claimExpiresAt: args.handoff.claimExpiresAt,
  };
}

async function activePreparedAccess(
  ctx: Pick<QueryCtx, "db">,
  handoff: Extract<Doc<"scoutHumanHandoffs">, { status: "available" | "active" }>,
  ownerAuthorized: boolean,
  now: number,
) {
  const context = await pageContext(ctx, handoff, ownerAuthorized);
  if (!context) return { status: "invalid" as const };
  if (handoffDeadline(handoff) <= now) return { status: "due" as const, handoffId: handoff._id };
  const resources = await handoffContext(ctx, handoff);
  if (!resources) {
    return { status: "broken" as const, handoffId: handoff._id };
  }
  const lifecycle = resources.session.lifecycle;
  if (
    resources.turn.state.kind === "failed" ||
    resources.turn.state.kind === "stopping" ||
    resources.turn.state.kind === "replacing" ||
    resources.turn.state.kind === "stopped" ||
    lifecycle.kind !== "active" ||
    lifecycle.providerExpiresAtMs <= now
  ) {
    return { status: "broken" as const, handoffId: handoff._id };
  }
  const interactiveLiveViewUrl = lifecycle.interactiveLiveViewUrl;
  if (interactiveLiveViewUrl === null) {
    return { status: "broken" as const, handoffId: handoff._id };
  }
  return handoff.status === "available"
    ? {
        ...context,
        status: "available" as const,
        claimExpiresAt: handoff.claimExpiresAt,
        interactiveLiveViewUrl,
      }
    : {
        ...context,
        status: "active" as const,
        expiresAt: handoff.expiresAt,
        interactiveLiveViewUrl,
      };
}

export const forSession = query({
  args: { sessionId: v.id("scoutBrowserSessions") },
  returns: v.union(chatHumanHandoffValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const handoff = await ctx.db
      .query("scoutHumanHandoffs")
      .withIndex("by_session_id", (index) => index.eq("sessionId", args.sessionId))
      .unique();
    if (!handoff) return null;
    const context = await handoffContext(ctx, handoff);
    if (!context || context.chat.userId !== userId) return null;
    const common = {
      handoffId: handoff._id,
      reason: handoff.reason,
      requestedAt: handoff.requestedAt,
    };
    switch (handoff.status) {
      case "available":
      case "active": {
        const now = Date.now();
        if (handoffDeadline(handoff) <= now) return { ...common, status: "expired" as const };
        if (resourcesAreUnavailable(context, now)) {
          return { ...common, status: "failed" as const, failure: "browser_ended" as const };
        }
        return { ...common, status: handoff.status, expiresAt: handoffDeadline(handoff) };
      }
      case "failed":
        return { ...common, status: handoff.status, failure: handoff.failure };
      case "continued":
      case "resumed":
      case "stopped":
      case "expired":
        return { ...common, status: handoff.status };
    }
  },
});

export const request = internalMutation({
  args: {
    promptMessageId: v.string(),
    reason: v.string(),
    accessTokenHash: v.string(),
  },
  returns: requestedHumanHandoffValidator,
  handler: async (ctx, args) => {
    const requestedAt = Date.now();
    const input = humanHandoffInputSchema.parse({
      reason: args.reason,
    });
    const reason = boundedReason(input.reason);
    const tokenHash = accessTokenHash(args.accessTokenHash);
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (index) =>
        index.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn || turn.state.kind !== "pending" || turn.state.leaseExpiresAt <= requestedAt) {
      throw new Error("Active Scout turn not found");
    }
    const chat = await ctx.db
      .query("scoutChats")
      .withIndex("by_thread_id", (index) => index.eq("threadId", turn.threadId))
      .unique();
    if (!chat || chat.scoutId !== turn.scoutId) {
      throw new Error("Scout chat not found");
    }
    const session = await ctx.db
      .query("scoutBrowserSessions")
      .withIndex("by_thread_id_and_sequence", (index) => index.eq("threadId", chat.threadId))
      .order("desc")
      .first();
    if (
      !session ||
      session.scoutId !== chat.scoutId ||
      session.lifecycle.kind !== "active" ||
      session.lifecycle.providerExpiresAtMs <= requestedAt + HUMAN_HANDOFF_ACTIVE_MS
    ) {
      throw new Error("Active Scout browser session not found");
    }
    const [user, scout] = await Promise.all([
      ctx.db.get("users", chat.userId),
      ctx.db.get("scouts", chat.scoutId),
    ]);
    const recipientEmail = user?.email?.trim();
    if (!recipientEmail) throw new Error("Chat owner has no email address");
    if (!scout) throw new Error("Human handoff context is unavailable");

    const existing = await ctx.db
      .query("scoutHumanHandoffs")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    if (
      existing?.status === "available" &&
      existing.turnId === turn._id &&
      existing.accessTokenHash === tokenHash
    ) {
      return requestResult({
        handoff: existing,
        created: false,
        recipientEmail,
        scoutName: scout.displayName,
      });
    }
    if (existing) throw new Error("Human handoff has already ended");
    const turnHandoff = await ctx.db
      .query("scoutHumanHandoffs")
      .withIndex("by_turn_id", (index) => index.eq("turnId", turn._id))
      .unique();
    if (turnHandoff) throw new Error("This Scout turn already requested human help");

    const workflowId = await humanHandoffWorkflow.start(
      ctx,
      internal.humanHandoffLifecycle.waitForOutcome,
      { sessionId: session._id },
      {
        onComplete: internal.humanHandoffLifecycle.onComplete,
        context: { sessionId: session._id, turnId: turn._id },
      },
    );
    const claimExpiresAt = Math.min(
      requestedAt + HUMAN_HANDOFF_CLAIM_MS,
      session.lifecycle.providerExpiresAtMs - HUMAN_HANDOFF_ACTIVE_MS,
    );
    const handoffId: Id<"scoutHumanHandoffs"> = await ctx.db.insert("scoutHumanHandoffs", {
      sessionId: session._id,
      turnId: turn._id,
      reason,
      requestedAt,
      claimExpiresAt,
      accessTokenHash: tokenHash,
      workflowId,
      status: "available",
    });
    await ctx.db.insert("scoutHumanHandoffDeliveries", {
      handoffId,
      inboxId: scout.agentMail.inboxId,
      recipientEmail,
      scoutName: scout.displayName,
    });
    await ctx.scheduler.runAt(claimExpiresAt, internal.humanHandoffs.expire, { handoffId });
    const handoff = await ctx.db.get("scoutHumanHandoffs", handoffId);
    if (!handoff || handoff.status !== "available") {
      throw new Error("Human handoff could not be created");
    }
    await ctx.scheduler.runAfter(0, internal.humanHandoffs.startDeliveryWorkflow, {
      handoffId,
    });
    return requestResult({
      handoff,
      created: true,
      recipientEmail,
      scoutName: scout.displayName,
    });
  },
});

export const startDeliveryWorkflow = internalMutation({
  args: humanHandoffDeliveryArgsValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    await humanHandoffWorkflow.start(ctx, internal.humanHandoffDeliveryWorkflow.deliverEmail, args);
    return null;
  },
});

export const prepareDelivery = internalQuery({
  args: { handoffId: v.id("scoutHumanHandoffs") },
  returns: preparedDeliveryValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("scoutHumanHandoffs", args.handoffId);
    if (!handoff || handoff.status !== "available") return { kind: "skipped" as const };
    const [delivery, turn] = await Promise.all([
      ctx.db
        .query("scoutHumanHandoffDeliveries")
        .withIndex("by_handoff_id", (index) => index.eq("handoffId", handoff._id))
        .unique(),
      ctx.db.get("scoutTurns", handoff.turnId),
    ]);
    if (!delivery || !turn) return { kind: "definitive_failure" as const };
    return {
      kind: "ready" as const,
      claimExpiresAt: handoff.claimExpiresAt,
      promptMessageId: turn.promptMessageId,
      accessTokenHash: handoff.accessTokenHash,
      inboxId: delivery.inboxId,
      recipientEmail: delivery.recipientEmail,
      scoutName: delivery.scoutName,
    };
  },
});

export const prepareAccess = internalQuery({
  args: { ...accessArgsValidator, now: v.number() },
  returns: preparedAccessValidator,
  handler: async (ctx, args) => {
    const authorized = await authorizedHandoff(ctx, args, args.now);
    if (!authorized) return { status: "invalid" as const };
    const { handoff, ownerAuthorized } = authorized;
    if (handoff.status === "available" || handoff.status === "active") {
      return await activePreparedAccess(ctx, handoff, ownerAuthorized, args.now);
    }
    return await terminalPage(ctx, handoff, ownerAuthorized);
  },
});

export const claimAuthorized = internalMutation({
  args: accessArgsValidator,
  returns: preparedAccessValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const authorized = await authorizedHandoff(ctx, args, now);
    if (!authorized) return { status: "invalid" as const };
    const { handoff, ownerAuthorized } = authorized;
    if (handoff.status !== "available") {
      if (handoff.status === "active") {
        return await activePreparedAccess(ctx, handoff, ownerAuthorized, now);
      }
      return await terminalPage(ctx, handoff, ownerAuthorized);
    }
    if (handoff.claimExpiresAt <= now) {
      return { status: "due" as const, handoffId: handoff._id };
    }
    const resources = await handoffContext(ctx, handoff);
    if (!resources) {
      return { status: "broken" as const, handoffId: handoff._id };
    }
    const lifecycle = resources.session.lifecycle;
    if (
      resources.turn.state.kind === "failed" ||
      resources.turn.state.kind === "stopping" ||
      resources.turn.state.kind === "replacing" ||
      resources.turn.state.kind === "stopped" ||
      lifecycle.kind !== "active" ||
      lifecycle.providerExpiresAtMs < now + HUMAN_HANDOFF_ACTIVE_MS
    ) {
      return { status: "broken" as const, handoffId: handoff._id };
    }
    const expiresAt = now + HUMAN_HANDOFF_ACTIVE_MS;
    await ctx.db.replace("scoutHumanHandoffs", handoff._id, {
      ...handoffCommon(handoff),
      status: "active",
      claimedAt: now,
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.humanHandoffs.expire, {
      handoffId: handoff._id,
    });
    const claimed = await ctx.db.get("scoutHumanHandoffs", handoff._id);
    if (!claimed || claimed.status !== "active") return { status: "invalid" as const };
    return await activePreparedAccess(ctx, claimed, ownerAuthorized, now);
  },
});

export const continueAuthorized = internalMutation({
  args: accessArgsValidator,
  returns: humanHandoffPageValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const authorized = await authorizedHandoff(ctx, args, now);
    if (!authorized) return { status: "invalid" as const };
    const { handoff, ownerAuthorized } = authorized;
    if (handoff.status !== "active") {
      if (handoff.status === "available") return { status: "invalid" as const };
      return await terminalPage(ctx, handoff, ownerAuthorized);
    }
    const context = await pageContext(ctx, handoff, ownerAuthorized);
    if (!context) return { status: "invalid" as const };
    if (handoff.expiresAt <= now) {
      await ctx.db.replace("scoutHumanHandoffs", handoff._id, {
        ...handoffCommon(handoff),
        ...handoffClaim(handoff),
        status: "expired",
        expiredAt: now,
        claimed: true,
      });
      await signalHumanHandoffOutcome(ctx, handoff, "expired");
      return { ...context, status: "expired" as const, expiredAt: now, claimed: true };
    }
    const resources = await handoffContext(ctx, handoff);
    if (!resources || resourcesAreUnavailable(resources, now)) {
      await ctx.db.replace("scoutHumanHandoffs", handoff._id, {
        ...handoffCommon(handoff),
        ...handoffClaim(handoff),
        status: "failed",
        failedAt: now,
        failure: "browser_ended",
        claimed: true,
      });
      await signalHumanHandoffOutcome(ctx, handoff, "failed");
      return {
        ...context,
        status: "failed" as const,
        failedAt: now,
        failure: "browser_ended" as const,
      };
    }
    await ctx.db.replace("scoutHumanHandoffs", handoff._id, {
      ...handoffCommon(handoff),
      ...handoffClaim(handoff),
      status: "continued",
      continuedAt: now,
    });
    await signalHumanHandoffOutcome(ctx, handoff, "continued");
    return { ...context, status: "continued" as const, continuedAt: now };
  },
});

export const failAccess = internalMutation({
  args: accessArgsValidator,
  returns: humanHandoffPageValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const authorized = await authorizedHandoff(ctx, args, now);
    if (!authorized) return { status: "invalid" as const };
    const { handoff, ownerAuthorized } = authorized;
    if (handoff.status !== "available" && handoff.status !== "active") {
      return await terminalPage(ctx, handoff, ownerAuthorized);
    }
    const context = await pageContext(ctx, handoff, ownerAuthorized);
    if (!context) return { status: "invalid" as const };
    if (handoffDeadline(handoff) <= now) {
      await ctx.db.replace("scoutHumanHandoffs", handoff._id, expiredHandoff(handoff, now));
      await signalHumanHandoffOutcome(ctx, handoff, "expired");
      return {
        ...context,
        status: "expired" as const,
        expiredAt: now,
        claimed: handoff.status === "active",
      };
    }
    await ctx.db.replace(
      "scoutHumanHandoffs",
      handoff._id,
      failedHandoff(handoff, { failedAt: now, failure: "browser_ended" }),
    );
    await signalHumanHandoffOutcome(ctx, handoff, "failed");
    return {
      ...context,
      status: "failed" as const,
      failedAt: now,
      failure: "browser_ended" as const,
    };
  },
});

export const failDelivery = internalMutation({
  args: { handoffId: v.id("scoutHumanHandoffs") },
  returns: humanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("scoutHumanHandoffs", args.handoffId);
    if (!handoff) return "missing";
    if (handoff.status !== "available") return handoff.status;
    const now = Date.now();
    if (handoff.claimExpiresAt <= now) {
      await ctx.db.replace("scoutHumanHandoffs", handoff._id, {
        ...handoffCommon(handoff),
        status: "expired",
        expiredAt: now,
        claimed: false,
      });
      await signalHumanHandoffOutcome(ctx, handoff, "expired");
      return "expired";
    }
    await ctx.db.replace("scoutHumanHandoffs", handoff._id, {
      ...handoffCommon(handoff),
      status: "failed",
      failedAt: now,
      failure: "delivery_failed",
      claimed: false,
    });
    await signalHumanHandoffOutcome(ctx, handoff, "failed");
    return "failed";
  },
});

export const expire = internalMutation({
  args: { handoffId: v.id("scoutHumanHandoffs") },
  returns: humanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("scoutHumanHandoffs", args.handoffId);
    if (!handoff) return "missing";
    if (handoff.status !== "available" && handoff.status !== "active") return handoff.status;
    const now = Date.now();
    if (now < handoffDeadline(handoff)) return handoff.status;
    await ctx.db.replace("scoutHumanHandoffs", handoff._id, expiredHandoff(handoff, now));
    await signalHumanHandoffOutcome(ctx, handoff, "expired");
    return "expired";
  },
});
