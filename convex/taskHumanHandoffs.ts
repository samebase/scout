import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getAppUserId, requireAppUser } from "./access";
import {
  activeTaskHumanHandoffValidator,
  expiredHandoff,
  failedHandoff,
  handoffClaim,
  handoffCommon,
  handoffDeadline,
  requestedTaskHumanHandoffValidator,
  signalTaskHumanHandoffOutcome,
  taskHumanHandoffDestinationValidator,
  taskHumanHandoffFailureValidator,
  taskHumanHandoffPageValidator,
  taskHumanHandoffStatusValidator,
} from "./taskHumanHandoffsModel";
import { taskHumanHandoffWorkflow } from "./taskHumanHandoffWorkflow";

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
  handoffId: v.id("taskHumanHandoffs"),
  reason: v.string(),
  scoutName: v.string(),
  destination: v.optional(taskHumanHandoffDestinationValidator),
};

const preparedAccessValidator = v.union(
  v.object({ status: v.literal("invalid") }),
  v.object({ status: v.literal("due"), handoffId: v.id("taskHumanHandoffs") }),
  v.object({ status: v.literal("broken"), handoffId: v.id("taskHumanHandoffs") }),
  v.object({
    status: v.literal("available"),
    ...pageContextFields,
    claimExpiresAt: v.number(),
    providerSessionId: v.string(),
  }),
  v.object({
    status: v.literal("active"),
    ...pageContextFields,
    expiresAt: v.number(),
    providerSessionId: v.string(),
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
    status: v.literal("failed"),
    ...pageContextFields,
    failedAt: v.number(),
    failure: taskHumanHandoffFailureValidator,
  }),
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

async function handoffContext(ctx: Pick<QueryCtx, "db">, handoff: Doc<"taskHumanHandoffs">) {
  const session = await ctx.db.get("taskBrowserSessions", handoff.sessionId);
  const attempt = session ? await ctx.db.get("taskAttempts", session.attemptId) : null;
  const task = attempt ? await ctx.db.get("productTasks", attempt.taskId) : null;
  const turn = session ? await ctx.db.get("scoutTurns", session.turnId) : null;
  if (
    !session ||
    !attempt ||
    !task ||
    !turn ||
    session.attemptId !== attempt._id ||
    session.turnId !== turn._id ||
    attempt.taskId !== task._id ||
    attempt.threadId !== turn.threadId ||
    attempt.scoutId !== turn.scoutId
  ) {
    return null;
  }
  return { session, attempt, task, turn };
}

function resourcesAreActive(context: NonNullable<Awaited<ReturnType<typeof handoffContext>>>) {
  return (
    context.attempt.state.kind === "active" &&
    context.turn.state.kind !== "failed" &&
    context.session.lifecycle.kind === "active"
  );
}

async function authorizedHandoff(ctx: DatabaseCtx, args: AccessArgs, now: number) {
  const handoffId = ctx.db.normalizeId("taskHumanHandoffs", args.handoffId);
  if (!handoffId) return null;
  const handoff = await ctx.db.get("taskHumanHandoffs", handoffId);
  if (!handoff) return null;
  const context = await handoffContext(ctx, handoff);
  if (!context) return null;
  const userId = await getAppUserId(ctx);
  const ownerAuthorized = userId === context.task.userId;
  const bearerAuthorized =
    args.accessTokenHash !== undefined &&
    ACCESS_TOKEN_HASH_PATTERN.test(args.accessTokenHash) &&
    handoffDeadline(handoff) + HUMAN_HANDOFF_ACCESS_GRACE_MS > now &&
    handoff.accessTokenHash === args.accessTokenHash;
  return ownerAuthorized || bearerAuthorized ? { handoff, ownerAuthorized } : null;
}

async function pageContext(
  ctx: Pick<QueryCtx, "db">,
  handoff: Doc<"taskHumanHandoffs">,
  ownerAuthorized: boolean,
) {
  const context = await handoffContext(ctx, handoff);
  if (!context) return null;
  const [product, scout] = await Promise.all([
    ctx.db.get("products", context.task.productId),
    ctx.db.get("scouts", context.attempt.scoutId),
  ]);
  if (!product || !scout) return null;
  return {
    handoffId: handoff._id,
    reason: handoff.reason,
    scoutName: scout.displayName,
    ...(ownerAuthorized
      ? {
          destination: {
            domain: product.domain,
            taskId: context.task._id,
            attemptId: context.attempt._id,
          },
        }
      : {}),
  };
}

async function terminalPage(
  ctx: Pick<QueryCtx, "db">,
  handoff: Doc<"taskHumanHandoffs">,
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
  handoff: Extract<Doc<"taskHumanHandoffs">, { status: "available" }>;
  created: boolean;
  recipientEmail: string;
  productName: string;
  scoutName: string;
}) {
  return {
    handoffId: args.handoff._id,
    created: args.created,
    recipientEmail: args.recipientEmail,
    productName: args.productName,
    scoutName: args.scoutName,
    claimExpiresAt: args.handoff.claimExpiresAt,
  };
}

async function activePreparedAccess(
  ctx: Pick<QueryCtx, "db">,
  handoff: Extract<Doc<"taskHumanHandoffs">, { status: "available" | "active" }>,
  ownerAuthorized: boolean,
  now: number,
) {
  const context = await pageContext(ctx, handoff, ownerAuthorized);
  if (!context) return { status: "invalid" as const };
  if (handoffDeadline(handoff) <= now) return { status: "due" as const, handoffId: handoff._id };
  const resources = await handoffContext(ctx, handoff);
  if (!resources || !resourcesAreActive(resources)) {
    return { status: "broken" as const, handoffId: handoff._id };
  }
  return handoff.status === "available"
    ? {
        ...context,
        status: "available" as const,
        claimExpiresAt: handoff.claimExpiresAt,
        providerSessionId: resources.session.providerSessionId,
      }
    : {
        ...context,
        status: "active" as const,
        expiresAt: handoff.expiresAt,
        providerSessionId: resources.session.providerSessionId,
      };
}

export const active = query({
  args: { sessionId: v.id("taskBrowserSessions") },
  returns: v.union(activeTaskHumanHandoffValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const handoff = await ctx.db
      .query("taskHumanHandoffs")
      .withIndex("by_session_id", (index) => index.eq("sessionId", args.sessionId))
      .unique();
    const now = Date.now();
    if (
      !handoff ||
      (handoff.status !== "available" && handoff.status !== "active") ||
      handoffDeadline(handoff) <= now
    ) {
      return null;
    }
    const context = await handoffContext(ctx, handoff);
    if (!context || context.task.userId !== userId || !resourcesAreActive(context)) return null;
    return {
      handoffId: handoff._id,
      reason: handoff.reason,
      requestedAt: handoff.requestedAt,
      expiresAt: handoffDeadline(handoff),
      phase: handoff.status === "available" ? ("unclaimed" as const) : ("claimed" as const),
    };
  },
});

export const request = internalMutation({
  args: {
    promptMessageId: v.string(),
    reason: v.string(),
    accessTokenHash: v.string(),
  },
  returns: requestedTaskHumanHandoffValidator,
  handler: async (ctx, args) => {
    const requestedAt = Date.now();
    const reason = boundedReason(args.reason);
    const tokenHash = accessTokenHash(args.accessTokenHash);
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (index) =>
        index.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn || turn.state.kind !== "pending" || turn.state.leaseExpiresAt <= requestedAt) {
      throw new Error("Active task turn not found");
    }
    const attempt = await ctx.db
      .query("taskAttempts")
      .withIndex("by_thread_id", (index) => index.eq("threadId", turn.threadId))
      .unique();
    if (!attempt || attempt.scoutId !== turn.scoutId || attempt.state.kind !== "active") {
      throw new Error("Active task attempt not found");
    }
    const task = await ctx.db.get("productTasks", attempt.taskId);
    const session = await ctx.db
      .query("taskBrowserSessions")
      .withIndex("by_turn_id", (index) => index.eq("turnId", turn._id))
      .unique();
    if (
      !task ||
      !session ||
      session.attemptId !== attempt._id ||
      session.lifecycle.kind !== "active"
    ) {
      throw new Error("Active task browser session not found");
    }
    const [user, product, scout] = await Promise.all([
      ctx.db.get("users", task.userId),
      ctx.db.get("products", task.productId),
      ctx.db.get("scouts", attempt.scoutId),
    ]);
    const recipientEmail = user?.email?.trim();
    if (!recipientEmail) throw new Error("Task operator has no email address");
    if (!product || !scout) throw new Error("Human handoff context is unavailable");

    const existing = await ctx.db
      .query("taskHumanHandoffs")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    if (existing?.status === "available" && existing.accessTokenHash === tokenHash) {
      return requestResult({
        handoff: existing,
        created: false,
        recipientEmail,
        productName: product.name,
        scoutName: scout.displayName,
      });
    }
    if (existing) throw new Error("Task human handoff has already ended");

    const workflowId = await taskHumanHandoffWorkflow.start(
      ctx,
      internal.taskHumanHandoffLifecycle.waitForOutcome,
      { sessionId: session._id },
    );
    const claimExpiresAt = requestedAt + HUMAN_HANDOFF_CLAIM_MS;
    const handoffId: Id<"taskHumanHandoffs"> = await ctx.db.insert("taskHumanHandoffs", {
      sessionId: session._id,
      reason,
      requestedAt,
      claimExpiresAt,
      accessTokenHash: tokenHash,
      workflowId,
      status: "available",
    });
    await ctx.scheduler.runAt(claimExpiresAt, internal.taskHumanHandoffs.expire, { handoffId });
    const handoff = await ctx.db.get("taskHumanHandoffs", handoffId);
    if (!handoff || handoff.status !== "available") {
      throw new Error("Task human handoff could not be created");
    }
    return requestResult({
      handoff,
      created: true,
      recipientEmail,
      productName: product.name,
      scoutName: scout.displayName,
    });
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
    if (!resources || !resourcesAreActive(resources)) {
      return { status: "broken" as const, handoffId: handoff._id };
    }
    const expiresAt = now + HUMAN_HANDOFF_ACTIVE_MS;
    await ctx.db.replace("taskHumanHandoffs", handoff._id, {
      ...handoffCommon(handoff),
      status: "active",
      claimedAt: now,
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.taskHumanHandoffs.expire, {
      handoffId: handoff._id,
    });
    const claimed = await ctx.db.get("taskHumanHandoffs", handoff._id);
    if (!claimed || claimed.status !== "active") return { status: "invalid" as const };
    return await activePreparedAccess(ctx, claimed, ownerAuthorized, now);
  },
});

export const continueAuthorized = internalMutation({
  args: accessArgsValidator,
  returns: taskHumanHandoffPageValidator,
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
      await ctx.db.replace("taskHumanHandoffs", handoff._id, {
        ...handoffCommon(handoff),
        ...handoffClaim(handoff),
        status: "expired",
        expiredAt: now,
        claimed: true,
      });
      await signalTaskHumanHandoffOutcome(ctx, handoff, "expired");
      return { ...context, status: "expired" as const, expiredAt: now, claimed: true };
    }
    const resources = await handoffContext(ctx, handoff);
    if (!resources || !resourcesAreActive(resources)) {
      await ctx.db.replace("taskHumanHandoffs", handoff._id, {
        ...handoffCommon(handoff),
        ...handoffClaim(handoff),
        status: "failed",
        failedAt: now,
        failure: "browser_ended",
        claimed: true,
      });
      await signalTaskHumanHandoffOutcome(ctx, handoff, "failed");
      return {
        ...context,
        status: "failed" as const,
        failedAt: now,
        failure: "browser_ended" as const,
      };
    }
    await ctx.db.replace("taskHumanHandoffs", handoff._id, {
      ...handoffCommon(handoff),
      ...handoffClaim(handoff),
      status: "continued",
      continuedAt: now,
    });
    await signalTaskHumanHandoffOutcome(ctx, handoff, "continued");
    return { ...context, status: "continued" as const, continuedAt: now };
  },
});

export const failAccess = internalMutation({
  args: accessArgsValidator,
  returns: taskHumanHandoffPageValidator,
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
      await ctx.db.replace("taskHumanHandoffs", handoff._id, expiredHandoff(handoff, now));
      await signalTaskHumanHandoffOutcome(ctx, handoff, "expired");
      return {
        ...context,
        status: "expired" as const,
        expiredAt: now,
        claimed: handoff.status === "active",
      };
    }
    await ctx.db.replace(
      "taskHumanHandoffs",
      handoff._id,
      failedHandoff(handoff, { failedAt: now, failure: "browser_ended" }),
    );
    await signalTaskHumanHandoffOutcome(ctx, handoff, "failed");
    return {
      ...context,
      status: "failed" as const,
      failedAt: now,
      failure: "browser_ended" as const,
    };
  },
});

export const failDelivery = internalMutation({
  args: { handoffId: v.id("taskHumanHandoffs") },
  returns: taskHumanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("taskHumanHandoffs", args.handoffId);
    if (!handoff) return "missing";
    if (handoff.status !== "available") return handoff.status;
    const now = Date.now();
    if (handoff.claimExpiresAt <= now) {
      await ctx.db.replace("taskHumanHandoffs", handoff._id, {
        ...handoffCommon(handoff),
        status: "expired",
        expiredAt: now,
        claimed: false,
      });
      await signalTaskHumanHandoffOutcome(ctx, handoff, "expired");
      return "expired";
    }
    await ctx.db.replace("taskHumanHandoffs", handoff._id, {
      ...handoffCommon(handoff),
      status: "failed",
      failedAt: now,
      failure: "delivery_failed",
      claimed: false,
    });
    await signalTaskHumanHandoffOutcome(ctx, handoff, "failed");
    return "failed";
  },
});

export const getStatus = internalQuery({
  args: { handoffId: v.id("taskHumanHandoffs") },
  returns: taskHumanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("taskHumanHandoffs", args.handoffId);
    return handoff?.status ?? "missing";
  },
});

export const expire = internalMutation({
  args: { handoffId: v.id("taskHumanHandoffs") },
  returns: taskHumanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("taskHumanHandoffs", args.handoffId);
    if (!handoff) return "missing";
    if (handoff.status !== "available" && handoff.status !== "active") return handoff.status;
    const now = Date.now();
    if (now < handoffDeadline(handoff)) return handoff.status;
    await ctx.db.replace("taskHumanHandoffs", handoff._id, expiredHandoff(handoff, now));
    await signalTaskHumanHandoffOutcome(ctx, handoff, "expired");
    return "expired";
  },
});
