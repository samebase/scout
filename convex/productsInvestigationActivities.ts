import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { PRODUCT_INVESTIGATION_PROVIDER } from "./productsModel";
import {
  productInvestigationActivityActorValidator,
  productInvestigationActivityMetricValidator,
  productInvestigationActivitySourceValidator,
} from "./productsInvestigationActivityModel";

const MAX_ACTIVITIES_PER_INVESTIGATION = 32;
const MAX_ARTIFACTS_PER_INVESTIGATION = 6;

async function activeInvestigation(
  ctx: Pick<MutationCtx, "db">,
  investigationId: Id<"productInvestigations">,
  startedAt: number,
) {
  const investigation = await ctx.db.get("productInvestigations", investigationId);
  if (
    !investigation ||
    investigation.provider !== PRODUCT_INVESTIGATION_PROVIDER ||
    investigation.status !== "running" ||
    investigation.startedAt !== startedAt
  ) {
    return null;
  }
  const product = await ctx.db.get("products", investigation.productId);
  return product?.activeInvestigationId === investigationId ? investigation : null;
}

async function activityByKey(
  ctx: Pick<MutationCtx, "db">,
  investigationId: Id<"productInvestigations">,
  key: string,
) {
  return await ctx.db
    .query("productInvestigationActivities")
    .withIndex("by_investigation_id_and_key", (query) =>
      query.eq("investigationId", investigationId).eq("key", key),
    )
    .unique();
}

function nextAttempt(activity: Doc<"productInvestigationActivities"> | null) {
  return activity?.lifecycle.status === "skipped" ? 1 : (activity?.lifecycle.attempt ?? 0) + 1;
}

export const start = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
    key: v.string(),
    sequence: v.number(),
    actor: productInvestigationActivityActorValidator,
    operation: v.string(),
    source: productInvestigationActivitySourceValidator,
  },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    if (!(await activeInvestigation(ctx, args.investigationId, args.investigationStartedAt))) {
      return null;
    }
    const existing = await activityByKey(ctx, args.investigationId, args.key);
    if (!existing) {
      const activities = await ctx.db
        .query("productInvestigationActivities")
        .withIndex("by_investigation_id_and_sequence", (query) =>
          query.eq("investigationId", args.investigationId),
        )
        .take(MAX_ACTIVITIES_PER_INVESTIGATION);
      if (activities.length >= MAX_ACTIVITIES_PER_INVESTIGATION) {
        throw new Error("Product investigation activity limit reached");
      }
    }
    const attempt = nextAttempt(existing);
    const fields = {
      investigationId: args.investigationId,
      key: args.key,
      sequence: args.sequence,
      actor: args.actor,
      operation: args.operation,
      source: args.source,
      lifecycle: {
        status: "running" as const,
        attempt,
        startedAt: Date.now(),
      },
    };
    if (existing) {
      await ctx.db.replace("productInvestigationActivities", existing._id, fields);
    } else {
      await ctx.db.insert("productInvestigationActivities", fields);
    }
    return attempt;
  },
});

export const complete = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
    key: v.string(),
    attempt: v.number(),
    metrics: v.array(productInvestigationActivityMetricValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await activeInvestigation(ctx, args.investigationId, args.investigationStartedAt))) {
      return false;
    }
    const activity = await activityByKey(ctx, args.investigationId, args.key);
    if (
      !activity ||
      activity.lifecycle.status !== "running" ||
      activity.lifecycle.attempt !== args.attempt
    ) {
      return false;
    }
    await ctx.db.replace("productInvestigationActivities", activity._id, {
      investigationId: activity.investigationId,
      key: activity.key,
      sequence: activity.sequence,
      actor: activity.actor,
      operation: activity.operation,
      source: activity.source,
      lifecycle: {
        status: "completed",
        attempt: activity.lifecycle.attempt,
        startedAt: activity.lifecycle.startedAt,
        completedAt: Date.now(),
        metrics: args.metrics,
      },
    });
    return true;
  },
});

export const fail = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
    key: v.string(),
    attempt: v.number(),
    failure: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await activeInvestigation(ctx, args.investigationId, args.investigationStartedAt))) {
      return false;
    }
    const activity = await activityByKey(ctx, args.investigationId, args.key);
    if (
      !activity ||
      activity.lifecycle.status !== "running" ||
      activity.lifecycle.attempt !== args.attempt
    ) {
      return false;
    }
    await ctx.db.replace("productInvestigationActivities", activity._id, {
      investigationId: activity.investigationId,
      key: activity.key,
      sequence: activity.sequence,
      actor: activity.actor,
      operation: activity.operation,
      source: activity.source,
      lifecycle: {
        status: "failed",
        attempt: activity.lifecycle.attempt,
        startedAt: activity.lifecycle.startedAt,
        failedAt: Date.now(),
        failure: args.failure,
      },
    });
    return true;
  },
});

export const skip = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
    key: v.string(),
    sequence: v.number(),
    actor: productInvestigationActivityActorValidator,
    operation: v.string(),
    source: productInvestigationActivitySourceValidator,
    reason: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!(await activeInvestigation(ctx, args.investigationId, args.investigationStartedAt))) {
      return false;
    }
    const existing = await activityByKey(ctx, args.investigationId, args.key);
    const fields = {
      investigationId: args.investigationId,
      key: args.key,
      sequence: args.sequence,
      actor: args.actor,
      operation: args.operation,
      source: args.source,
      lifecycle: {
        status: "skipped" as const,
        skippedAt: Date.now(),
        reason: args.reason,
      },
    };
    if (existing) {
      await ctx.db.replace("productInvestigationActivities", existing._id, fields);
    } else {
      await ctx.db.insert("productInvestigationActivities", fields);
    }
    return true;
  },
});

export const storeArtifact = internalMutation({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
    sequence: v.number(),
    url: v.string(),
    title: v.string(),
    markdown: v.string(),
  },
  returns: v.union(v.id("productInvestigationArtifacts"), v.null()),
  handler: async (ctx, args) => {
    if (!(await activeInvestigation(ctx, args.investigationId, args.investigationStartedAt))) {
      return null;
    }
    const existing = await ctx.db
      .query("productInvestigationArtifacts")
      .withIndex("by_investigation_id_and_sequence", (query) =>
        query.eq("investigationId", args.investigationId).eq("sequence", args.sequence),
      )
      .unique();
    const fields = {
      investigationId: args.investigationId,
      startedAt: args.investigationStartedAt,
      sequence: args.sequence,
      url: args.url,
      title: args.title,
      markdown: args.markdown,
      createdAt: Date.now(),
    };
    if (existing) {
      await ctx.db.replace("productInvestigationArtifacts", existing._id, fields);
      return existing._id;
    }
    const artifacts = await ctx.db
      .query("productInvestigationArtifacts")
      .withIndex("by_investigation_id_and_sequence", (query) =>
        query.eq("investigationId", args.investigationId),
      )
      .take(MAX_ARTIFACTS_PER_INVESTIGATION);
    if (artifacts.length >= MAX_ARTIFACTS_PER_INVESTIGATION) {
      throw new Error("Product investigation artifact limit reached");
    }
    return await ctx.db.insert("productInvestigationArtifacts", fields);
  },
});

export const loadArtifacts = internalQuery({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
    artifactIds: v.array(v.id("productInvestigationArtifacts")),
  },
  returns: v.array(
    v.object({
      url: v.string(),
      title: v.string(),
      markdown: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.artifactIds.length > MAX_ARTIFACTS_PER_INVESTIGATION) {
      throw new Error("Too many product investigation artifacts requested");
    }
    const pages = [];
    for (const artifactId of args.artifactIds) {
      const artifact = await ctx.db.get("productInvestigationArtifacts", artifactId);
      if (
        !artifact ||
        artifact.investigationId !== args.investigationId ||
        artifact.startedAt !== args.investigationStartedAt
      ) {
        throw new Error("Product investigation artifact is unavailable");
      }
      pages.push({ url: artifact.url, title: artifact.title, markdown: artifact.markdown });
    }
    return pages;
  },
});

export const listArtifacts = internalQuery({
  args: {
    investigationId: v.id("productInvestigations"),
    investigationStartedAt: v.number(),
  },
  returns: v.array(
    v.object({
      artifactId: v.id("productInvestigationArtifacts"),
      sequence: v.number(),
      url: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const artifacts = await ctx.db
      .query("productInvestigationArtifacts")
      .withIndex("by_investigation_id_and_sequence", (query) =>
        query.eq("investigationId", args.investigationId),
      )
      .take(MAX_ARTIFACTS_PER_INVESTIGATION);
    return artifacts
      .filter((artifact) => artifact.startedAt === args.investigationStartedAt)
      .map((artifact) => ({
        artifactId: artifact._id,
        sequence: artifact.sequence,
        url: artifact.url,
      }));
  },
});
