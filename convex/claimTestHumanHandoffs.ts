import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireAppUser } from "./access";
import {
  activeClaimTestHumanHandoffValidator,
  claimTestHumanHandoffStatusValidator,
  requestedClaimTestHumanHandoffValidator,
  terminalHandoffIdentity,
} from "./claimTestHumanHandoffsModel";
import {
  findCurrentProductClaim,
  routeClaimKey,
  runMatchesCurrentClaim,
  type ProjectedProductClaim,
} from "./productClaimEdits";
import { canonicalProductDomain } from "./productsDomain";
import { requireFirecrawlLiveViewUrl } from "./scout/lib/firecrawlLiveView";

const HUMAN_HANDOFF_WAIT_MS = 5 * 60 * 1_000;
const MAX_HANDOFF_REASON_LENGTH = 500;

type DatabaseContext = Pick<QueryCtx, "db">;

function boundedReason(value: string) {
  const reason = value.trim().replaceAll(/\s+/g, " ");
  if (!reason) throw new Error("Human help reason cannot be empty");
  if (Array.from(reason).length > MAX_HANDOFF_REASON_LENGTH) {
    throw new Error(`Human help reason must be ${MAX_HANDOFF_REASON_LENGTH} characters or fewer`);
  }
  return reason;
}

function routeProductDomain(value: string) {
  try {
    return canonicalProductDomain(value, "Product domain");
  } catch {
    return null;
  }
}

async function latestRunForClaim(
  ctx: DatabaseContext,
  args: {
    userId: Id<"users">;
    productId: Id<"products">;
    investigationId: Id<"productInvestigations">;
    claim: ProjectedProductClaim;
  },
) {
  if (args.claim.origin === "custom") {
    return await ctx.db
      .query("claimTestRuns")
      .withIndex("by_user_id_and_product_id_and_claim_key", (index) =>
        index
          .eq("userId", args.userId)
          .eq("productId", args.productId)
          .eq("claimKey", args.claim.claimKey),
      )
      .order("desc")
      .first();
  }
  return await ctx.db
    .query("claimTestRuns")
    .withIndex("by_user_id_and_product_id_and_investigation_id_and_claim_key", (index) =>
      index
        .eq("userId", args.userId)
        .eq("productId", args.productId)
        .eq("investigationId", args.investigationId)
        .eq("claimKey", args.claim.claimKey),
    )
    .order("desc")
    .first();
}

async function currentPendingRun(
  ctx: DatabaseContext,
  args: { userId: Id<"users">; domain: string; claimKey: string },
) {
  const current = await findCurrentProductClaim(ctx, args);
  if (!current) return null;
  const run = await latestRunForClaim(ctx, {
    userId: args.userId,
    productId: current.product._id,
    investigationId: current.investigation._id,
    claim: current.claim,
  });
  if (!run || !runMatchesCurrentClaim(run.testedClaim, current.claim)) return null;
  const generation = await ctx.db.get("scoutLabGenerations", run.generationId);
  return generation?.status === "pending" ? { run, generation } : null;
}

function requestResult(args: {
  handoff: Extract<Doc<"claimTestHumanHandoffs">, { status: "waiting" }>;
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
    interactiveLiveViewUrl: args.handoff.interactiveLiveViewUrl,
    expiresAt: args.handoff.expiresAt,
  };
}

export const active = query({
  args: {
    domain: v.string(),
    claimKey: v.string(),
  },
  returns: v.union(activeClaimTestHumanHandoffValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const domain = routeProductDomain(args.domain);
    const claimKey = routeClaimKey(args.claimKey);
    if (domain === null || claimKey === null) return null;
    const current = await currentPendingRun(ctx, { userId, domain, claimKey });
    if (!current) return null;
    const handoff = await ctx.db
      .query("claimTestHumanHandoffs")
      .withIndex("by_generation_id", (index) => index.eq("generationId", current.generation._id))
      .unique();
    if (!handoff || handoff.status !== "waiting") return null;
    if (handoff.runId !== current.run._id || handoff.userId !== userId) {
      throw new Error("Claim test human handoff has an invalid ownership binding");
    }
    return {
      runId: handoff.runId,
      reason: handoff.reason,
      requestedAt: handoff.requestedAt,
      expiresAt: handoff.expiresAt,
      url: requireFirecrawlLiveViewUrl(handoff.interactiveLiveViewUrl),
    };
  },
});

export const continueCurrent = mutation({
  args: {
    domain: v.string(),
    claimKey: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const domain = canonicalProductDomain(args.domain, "Product domain");
    const claimKey = routeClaimKey(args.claimKey);
    if (claimKey === null) return false;
    const current = await currentPendingRun(ctx, { userId, domain, claimKey });
    if (!current) return false;
    const handoff = await ctx.db
      .query("claimTestHumanHandoffs")
      .withIndex("by_generation_id", (index) => index.eq("generationId", current.generation._id))
      .unique();
    if (!handoff || handoff.status !== "waiting") return false;
    if (handoff.runId !== current.run._id || handoff.userId !== userId) return false;
    await ctx.db.replace("claimTestHumanHandoffs", handoff._id, {
      ...terminalHandoffIdentity(handoff),
      status: "continued",
      continuedAt: Date.now(),
    });
    return true;
  },
});

export const request = internalMutation({
  args: {
    promptMessageId: v.string(),
    reason: v.string(),
    interactiveLiveViewUrl: v.string(),
  },
  returns: requestedClaimTestHumanHandoffValidator,
  handler: async (ctx, args) => {
    const reason = boundedReason(args.reason);
    const interactiveLiveViewUrl = requireFirecrawlLiveViewUrl(args.interactiveLiveViewUrl);
    const generation = await ctx.db
      .query("scoutLabGenerations")
      .withIndex("by_prompt_message_id", (index) =>
        index.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!generation || generation.status !== "pending") {
      throw new Error("Active claim test generation not found");
    }
    const run = await ctx.db
      .query("claimTestRuns")
      .withIndex("by_generation_id", (index) => index.eq("generationId", generation._id))
      .unique();
    if (!run) throw new Error("Claim test run not found");
    const browserSession = await ctx.db
      .query("claimTestBrowserSessions")
      .withIndex("by_generation_id", (index) => index.eq("generationId", generation._id))
      .unique();
    if (
      !browserSession ||
      browserSession.runId !== run._id ||
      browserSession.userId !== run.userId ||
      browserSession.lifecycle.kind !== "active"
    ) {
      throw new Error("Active claim test browser session not found");
    }

    const [user, product, scout] = await Promise.all([
      ctx.db.get("users", run.userId),
      ctx.db.get("products", run.productId),
      ctx.db.get("scouts", run.scoutId),
    ]);
    const recipientEmail = user?.email?.trim();
    if (!recipientEmail) throw new Error("Claim test operator has no email address");
    if (!product || !scout) throw new Error("Claim test human handoff context is unavailable");

    const existing = await ctx.db
      .query("claimTestHumanHandoffs")
      .withIndex("by_generation_id", (index) => index.eq("generationId", generation._id))
      .unique();
    if (existing?.status === "waiting") {
      if (existing.runId !== run._id || existing.userId !== run.userId) {
        throw new Error("Claim test human handoff has an invalid run binding");
      }
      if (existing.interactiveLiveViewUrl !== interactiveLiveViewUrl) {
        throw new Error("Claim test already has a different interactive browser link");
      }
      return requestResult({
        handoff: existing,
        created: false,
        recipientEmail,
        productName: product.name,
        scoutName: scout.displayName,
      });
    }
    if (existing) {
      throw new Error("Claim test human handoff has already ended");
    }

    const requestedAt = Date.now();
    const expiresAt = requestedAt + HUMAN_HANDOFF_WAIT_MS;
    const handoffFields = {
      generationId: generation._id,
      runId: run._id,
      userId: run.userId,
      reason,
      requestedAt,
      status: "waiting" as const,
      interactiveLiveViewUrl,
      expiresAt,
    };
    const handoffId: Id<"claimTestHumanHandoffs"> = await ctx.db.insert(
      "claimTestHumanHandoffs",
      handoffFields,
    );
    await ctx.scheduler.runAt(expiresAt, internal.claimTestHumanHandoffs.expire, { handoffId });
    const handoff = await ctx.db.get("claimTestHumanHandoffs", handoffId);
    if (!handoff || handoff.status !== "waiting") {
      throw new Error("Claim test human handoff could not be created");
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

export const getStatus = internalQuery({
  args: { handoffId: v.id("claimTestHumanHandoffs") },
  returns: claimTestHumanHandoffStatusValidator,
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("claimTestHumanHandoffs", args.handoffId);
    return handoff?.status ?? "missing";
  },
});

export const expire = internalMutation({
  args: { handoffId: v.id("claimTestHumanHandoffs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const handoff = await ctx.db.get("claimTestHumanHandoffs", args.handoffId);
    if (!handoff || handoff.status !== "waiting") return null;
    await ctx.db.replace("claimTestHumanHandoffs", handoff._id, {
      ...terminalHandoffIdentity(handoff),
      status: "expired",
      expiredAt: Date.now(),
    });
    return null;
  },
});
