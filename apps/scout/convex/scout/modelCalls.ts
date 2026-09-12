import { action, query } from "../functions";
import { type Infer, v } from "convex/values";
import { requirePermission } from "../access";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { requireOwnedAgentThread } from "./chatAccess";
import schema from "../schema";
import { omitNullish } from "../../shared/omitNullish";
import {
  modelCallPurposeValidator,
  scoutFinishReasonValidator,
  scoutModelCallStateValidator,
  scoutTokenUsageValidator,
} from "./models";
import { addScoutTokenUsage } from "./models";

const MAX_MODEL_CALLS_PER_TURN = 500;

export const modelCallSummaryValidator = v.object({
  modelCallId: v.id("scoutModelCalls"),
  purpose: v.optional(modelCallPurposeValidator),
  sequence: v.number(),
  provider: v.string(),
  modelId: v.string(),
  startedAt: v.number(),
  messageCount: v.number(),
  toolCount: v.number(),
  compactedBrowserSnapshotCount: v.number(),
  serializedBytes: v.number(),
  state: scoutModelCallStateValidator,
});

export type ModelCallSummary = Infer<typeof modelCallSummaryValidator>;
const compactionContextValidator = v.union(
  v.object({
    checkpoint: schema.doc("scoutCompactions"),
    call: modelCallSummaryValidator,
  }),
  v.null(),
);
type CompactionContext = Infer<typeof compactionContextValidator>;
type ModelCallContext = {
  summary: ModelCallSummary;
  snapshot: string;
  compaction: CompactionContext;
} | null;
type AuthorizedModelCallContext = {
  summary: ModelCallSummary;
  snapshotStorageId: Id<"_storage">;
  compaction: CompactionContext;
} | null;

export function modelCallSummary(call: {
  purpose?: ModelCallSummary["purpose"];
  _id: ModelCallSummary["modelCallId"];
  sequence: number;
  provider: string;
  modelId: string;
  startedAt: number;
  messageCount: number;
  toolCount: number;
  compactedBrowserSnapshotCount: number;
  serializedBytes: number;
  state: ModelCallSummary["state"];
}): ModelCallSummary {
  return {
    modelCallId: call._id,
    ...omitNullish({ purpose: call.purpose }),
    sequence: call.sequence,
    provider: call.provider,
    modelId: call.modelId,
    startedAt: call.startedAt,
    messageCount: call.messageCount,
    toolCount: call.toolCount,
    compactedBrowserSnapshotCount: call.compactedBrowserSnapshotCount,
    serializedBytes: call.serializedBytes,
    state: call.state,
  };
}

export const recordStart = internalMutation({
  args: {
    turnId: v.id("scoutTurns"),
    purpose: modelCallPurposeValidator,
    provider: v.string(),
    modelId: v.string(),
    messageCount: v.number(),
    toolCount: v.number(),
    compactedBrowserSnapshotCount: v.number(),
    serializedBytes: v.number(),
    snapshotStorageId: v.id("_storage"),
  },
  returns: v.id("scoutModelCalls"),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn || turn.state.kind !== "pending") {
      throw new Error("Active Scout turn not found");
    }
    const previous = await ctx.db
      .query("scoutModelCalls")
      .withIndex("by_turn_id_and_sequence", (index) => index.eq("turnId", args.turnId))
      .order("desc")
      .first();
    const modelCallId = await ctx.db.insert("scoutModelCalls", {
      turnId: args.turnId,
      purpose: args.purpose,
      sequence: (previous?.sequence ?? 0) + 1,
      provider: args.provider,
      modelId: args.modelId,
      startedAt: Date.now(),
      messageCount: args.messageCount,
      toolCount: args.toolCount,
      compactedBrowserSnapshotCount: args.compactedBrowserSnapshotCount,
      serializedBytes: args.serializedBytes,
      snapshotStorageId: args.snapshotStorageId,
      state: { kind: "pending" },
    });
    return modelCallId;
  },
});

export const failOne = internalMutation({
  args: { modelCallId: v.id("scoutModelCalls"), failure: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.modelCallId);
    if (!call || call.state.kind !== "pending") return null;
    await ctx.db.patch(call._id, {
      state: { kind: "failed", failedAt: Date.now(), failure: args.failure },
    });
    return null;
  },
});

export const recordEnd = internalMutation({
  args: {
    modelCallId: v.id("scoutModelCalls"),
    finishReason: scoutFinishReasonValidator,
    usage: scoutTokenUsageValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.modelCallId);
    if (!call || call.state.kind !== "pending") return null;
    const turn = await ctx.db.get(call.turnId);
    await ctx.db.patch(call._id, {
      state: {
        kind: "completed",
        finishedAt: Date.now(),
        finishReason: args.finishReason,
        usage: args.usage,
      },
    });
    if (turn) {
      await ctx.db.patch(turn._id, {
        state: {
          ...turn.state,
          usage: addScoutTokenUsage(turn.state.usage, args.usage),
        },
      });
    }
    return null;
  },
});

export async function failPendingModelCall(
  ctx: MutationCtx,
  turnId: Doc<"scoutTurns">["_id"],
  failure: string,
) {
  const pending = await ctx.db
    .query("scoutModelCalls")
    .withIndex("by_turn_id_and_sequence", (index) => index.eq("turnId", turnId))
    .order("desc")
    .first();
  if (pending?.state.kind === "pending") {
    await ctx.db.patch(pending._id, {
      state: { kind: "failed", failedAt: Date.now(), failure },
    });
  }
}

export const failPending = internalMutation({
  args: { turnId: v.id("scoutTurns"), failure: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await failPendingModelCall(ctx, args.turnId, args.failure);
    return null;
  },
});

export const listForTurn = query({
  access: "access_lab",
  args: { turnId: v.id("scoutTurns") },
  returns: v.array(modelCallSummaryValidator),
  handler: async (ctx, args) => {
    const userId = ctx.viewer.userId;
    const turn = await ctx.db.get(args.turnId);
    if (!turn) return [];
    await requireOwnedAgentThread(ctx, turn.threadId, userId);
    return (
      await ctx.db
        .query("scoutModelCalls")
        .withIndex("by_turn_id_and_sequence", (index) => index.eq("turnId", args.turnId))
        .order("asc")
        .take(MAX_MODEL_CALLS_PER_TURN)
    ).map(modelCallSummary);
  },
});

export const authorizedContext = internalQuery({
  args: { modelCallId: v.string(), threadId: v.string() },
  returns: v.union(
    v.object({
      summary: modelCallSummaryValidator,
      snapshotStorageId: v.id("_storage"),
      compaction: compactionContextValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<AuthorizedModelCallContext> => {
    const userId = (await requirePermission(ctx, "access_lab")).userId;
    const modelCallId = ctx.db.normalizeId("scoutModelCalls", args.modelCallId);
    if (!modelCallId) return null;
    const call = await ctx.db.get(modelCallId);
    if (!call) return null;
    const turn = await ctx.db.get(call.turnId);
    if (!turn || turn.threadId !== args.threadId) return null;
    await requireOwnedAgentThread(ctx, turn.threadId, userId);
    const checkpoint =
      call.purpose?.kind === "compaction"
        ? await ctx.db
            .query("scoutCompactions")
            .withIndex("by_model_call_id", (q) => q.eq("modelCallId", call._id))
            .unique()
        : call.purpose?.compactionId
          ? await ctx.db.get(call.purpose.compactionId)
          : null;
    const compactionCall =
      checkpoint && checkpoint.threadId === turn.threadId
        ? await ctx.db.get(checkpoint.modelCallId)
        : null;
    return {
      summary: modelCallSummary(call),
      snapshotStorageId: call.snapshotStorageId,
      compaction:
        checkpoint && compactionCall
          ? { checkpoint, call: modelCallSummary(compactionCall) }
          : null,
    };
  },
});

export const getContext = action({
  access: "access_lab",
  args: { modelCallId: v.string(), threadId: v.string() },
  returns: v.union(
    v.object({
      summary: modelCallSummaryValidator,
      snapshot: v.string(),
      compaction: compactionContextValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<ModelCallContext> => {
    const authorized = await ctx.runQuery(internal.scout.modelCalls.authorizedContext, args);
    if (!authorized) return null;
    const blob = await ctx.storage.get(authorized.snapshotStorageId);
    if (!blob) return null;
    return {
      summary: authorized.summary,
      snapshot: await blob.text(),
      compaction: authorized.compaction,
    };
  },
});
