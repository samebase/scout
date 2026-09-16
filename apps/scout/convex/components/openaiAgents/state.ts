import type { FunctionHandle } from "convex/server";
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { event, notification } from "../../../shared/openaiAgents";
import schema from "./schema";

async function find(ctx: QueryCtx, sessionKey: string) {
  return await ctx.db
    .query("sessions")
    .withIndex("by_sessionKey", (q) => q.eq("sessionKey", sessionKey))
    .unique();
}

async function notify(ctx: MutationCtx, session: Doc<"sessions">, update: Infer<typeof event>) {
  // Convex serializes a createFunctionHandle result as a string across component boundaries.
  // @ts-expect-error The persisted value is the app-provided mutation handle; Convex validates its arguments.
  const callback: FunctionHandle<"mutation", Infer<typeof notification>, null> = session.onEvent;
  await ctx.runMutation(callback, {
    sessionKey: session.sessionKey,
    runKey: session.runKey,
    event: update,
  });
}

async function schedule(ctx: MutationCtx, session: Doc<"sessions">) {
  const job = session.syncJobId ? await ctx.db.system.get(session.syncJobId) : null;
  if (job?.state.kind === "pending" || job?.state.kind === "inProgress") return;
  const syncJobId = await ctx.scheduler.runAfter(0, internal.runtime.sync, {
    sessionId: session._id,
  });
  await ctx.db.patch(session._id, { syncJobId, syncError: null });
}

export const get = query({
  args: { sessionKey: v.string() },
  returns: v.union(schema.doc("sessions"), v.null()),
  handler: async (ctx, { sessionKey }) => await find(ctx, sessionKey),
});

export const read = query({
  args: { sessionId: v.id("sessions") },
  returns: schema.doc("sessions"),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("OpenAI session not found");
    return session;
  },
});

export const register = mutation({
  args: { sessionKey: v.string(), runKey: v.string(), onEvent: v.string() },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    if (await find(ctx, args.sessionKey)) throw new Error("OpenAI session already registered");
    return await ctx.db.insert("sessions", {
      ...args,
      providerId: null,
      previousTurnId: null,
      stopped: false,
      generation: 0,
      revision: 0,
      syncJobId: null,
      syncError: null,
      itemCursor: null,
      nextSequence: 0,
    });
  },
});

export const attach = internalMutation({
  args: { sessionId: v.id("sessions"), providerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, providerId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.providerId) throw new Error("Invalid OpenAI session attachment");
    await ctx.db.patch(sessionId, { providerId });
    await notify(ctx, session, { kind: "created", providerId });
    return null;
  },
});

export const prepare = mutation({
  args: {
    sessionKey: v.string(),
    runKey: v.string(),
    previousTurnId: v.union(v.string(), v.null()),
    expectedGeneration: v.number(),
  },
  returns: schema.doc("sessions"),
  handler: async (ctx, { sessionKey, expectedGeneration, ...patch }) => {
    const session = await find(ctx, sessionKey);
    if (!session) throw new Error("OpenAI session not found");
    if (session.generation !== expectedGeneration)
      throw new Error("Session command was superseded");
    const next = { ...session, ...patch, stopped: false, generation: session.generation + 1 };
    await ctx.db.patch(session._id, { ...patch, stopped: false, generation: next.generation });
    return next;
  },
});

export const submitted = query({
  args: { sessionId: v.id("sessions"), callId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) =>
    Boolean(
      await ctx.db
        .query("submittedResults")
        .withIndex("by_sessionId_and_callId", (q) =>
          q.eq("sessionId", args.sessionId).eq("callId", args.callId),
        )
        .unique(),
    ),
});

export const recordResult = internalMutation({
  args: { sessionId: v.id("sessions"), callId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("submittedResults")
      .withIndex("by_sessionId_and_callId", (q) =>
        q.eq("sessionId", args.sessionId).eq("callId", args.callId),
      )
      .unique();
    if (!existing) await ctx.db.insert("submittedResults", args);
    return null;
  },
});

export const stop = mutation({
  args: { sessionKey: v.string() },
  returns: v.union(schema.doc("sessions"), v.null()),
  handler: async (ctx, { sessionKey }) => {
    const session = await find(ctx, sessionKey);
    if (!session) return null;
    const next = { ...session, stopped: true, generation: session.generation + 1 };
    await ctx.db.patch(session._id, { stopped: true, generation: next.generation });
    return next;
  },
});

export const refresh = mutation({
  args: { sessionKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionKey }) => {
    const session = await find(ctx, sessionKey);
    if (!session?.providerId) return null;
    await ctx.db.patch(session._id, { revision: session.revision + 1 });
    await schedule(ctx, session);
    return null;
  },
});

export const receive = internalMutation({
  args: { eventId: v.string(), providerId: v.string(), type: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const duplicate = await ctx.db
      .query("webhooks")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (duplicate) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_providerId", (q) => q.eq("providerId", args.providerId))
      .unique();
    // A project can deliver events for sessions owned by other apps or deployments.
    if (!session) return null;
    await ctx.db.insert("webhooks", {
      eventId: args.eventId,
      type: args.type,
      sessionId: session._id,
    });
    await ctx.db.patch(session._id, { revision: session.revision + 1 });
    await schedule(ctx, session);
    return null;
  },
});

export const publish = internalMutation({
  args: { sessionId: v.id("sessions"), generation: v.number(), event },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.generation !== args.generation) return null;
    if (session.stopped && args.event.kind === "tool") return null;
    await notify(ctx, session, args.event);
    return null;
  },
});

export const checkpoint = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    generation: v.number(),
    itemCursor: v.union(v.string(), v.null()),
    nextSequence: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, generation, ...patch }) => {
    const session = await ctx.db.get(sessionId);
    if (session?.generation === generation) await ctx.db.patch(sessionId, patch);
    return null;
  },
});

export const finish = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    generation: v.number(),
    revision: v.number(),
    error: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    const error = session.generation === args.generation ? args.error : null;
    const syncJobId =
      (session.revision > args.revision || session.generation !== args.generation) && error === null
        ? await ctx.scheduler.runAfter(0, internal.runtime.sync, { sessionId: session._id })
        : null;
    await ctx.db.patch(session._id, { syncJobId, syncError: error });
    return null;
  },
});
