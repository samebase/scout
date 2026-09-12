import { listMessages } from "@convex-dev/agent";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { publicQuery } from "../functions";
import { requireViewerPermission } from "../access";
import { canAccess } from "../../shared/accessModel";
import { chatPermission, scoutIsWorking, visibleChat } from "./chatAccess";
import { chatPurposeValidator, chatVisibilityValidator, productKindValidator } from "./chatModel";
import { scoutAgent } from "./agent";
import { MAX_BROWSER_SESSIONS_PER_THREAD } from "./browserSessions";
import { requireFirecrawlLiveViewUrl } from "./lib/firecrawlLiveView";

const scoutValidator = v.object({
  _id: v.id("scouts"),
  displayName: v.string(),
  status: v.union(v.literal("active"), v.literal("disabled")),
});
const sessionValidator = v.object({
  sessionId: v.id("scoutBrowserSessions"),
  createdAt: v.number(),
  kind: v.union(v.literal("active"), v.literal("closing"), v.literal("closed")),
});
const statusValidator = v.union(
  v.literal("ready"),
  v.literal("running"),
  v.literal("waiting"),
  v.literal("finished"),
  v.literal("stopping"),
  v.literal("stopped"),
  v.literal("failed"),
);
const activityValidator = v.object({
  threadId: v.string(),
  title: v.union(v.string(), v.null()),
  createdAt: v.number(),
  purpose: chatPurposeValidator,
  visibility: chatVisibilityValidator,
  scout: scoutValidator,
  status: statusValidator,
  latestSession: v.union(sessionValidator, v.null()),
});

function sessionSummary(session: Doc<"scoutBrowserSessions">) {
  return { sessionId: session._id, createdAt: session._creationTime, kind: session.lifecycle.kind };
}

async function activityStatus(ctx: QueryCtx, threadId: string) {
  const turn = await ctx.db
    .query("scoutTurns")
    .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", threadId))
    .order("desc")
    .first();
  if (!turn) return "ready" as const;
  switch (turn.state.kind) {
    case "pending":
      return "running" as const;
    case "stopping":
    case "replacing":
      return "stopping" as const;
    case "stopped":
      return "stopped" as const;
    case "failed":
      return "failed" as const;
    case "completed": {
      const handoff = await ctx.db
        .query("scoutHumanHandoffs")
        .withIndex("by_turn_id", (q) => q.eq("turnId", turn._id))
        .unique();
      return handoff && ["available", "active", "continued"].includes(handoff.status)
        ? ("waiting" as const)
        : ("finished" as const);
    }
  }
}

async function summary(ctx: QueryCtx, chat: Doc<"scoutChats">) {
  const [thread, scout, status, session] = await Promise.all([
    scoutAgent.getThreadMetadata(ctx, { threadId: chat.threadId }),
    ctx.db.get(chat.scoutId),
    activityStatus(ctx, chat.threadId),
    ctx.db
      .query("scoutBrowserSessions")
      .withIndex("by_thread_id_and_sequence", (q) => q.eq("threadId", chat.threadId))
      .order("desc")
      .first(),
  ]);
  if (!scout) throw new Error("Scout not found");
  return {
    threadId: chat.threadId,
    title: thread.title ?? null,
    createdAt: chat.createdAt,
    purpose: chat.purpose,
    visibility: chat.visibility,
    status,
    scout: { _id: scout._id, displayName: scout.displayName, status: scout.status },
    latestSession: session ? sessionSummary(session) : null,
  };
}

export const list = publicQuery({
  access: "access_public",
  args: {
    kind: v.union(v.literal("all"), productKindValidator),
    scope: v.union(v.literal("public"), v.literal("mine")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(activityValidator),
  handler: async (ctx, args) => {
    const kind = args.kind;
    const rows =
      args.scope === "public"
        ? kind === "all"
          ? ctx.db
              .query("scoutChats")
              .withIndex("by_visibility_and_created_at", (q) => q.eq("visibility", "public"))
              .filter((q) => q.neq(q.field("purpose.kind"), "general"))
          : ctx.db
              .query("scoutChats")
              .withIndex("by_visibility_and_purpose_kind_and_created_at", (q) =>
                q.eq("visibility", "public").eq("purpose.kind", kind),
              )
        : kind === "all"
          ? ctx.db
              .query("scoutChats")
              .withIndex("by_user_id_and_created_at", (q) =>
                q.eq("userId", requireViewerPermission(ctx.viewer, "access_account").userId),
              )
              .filter((q) => q.neq(q.field("purpose.kind"), "general"))
          : ctx.db
              .query("scoutChats")
              .withIndex("by_user_id_and_purpose_kind_and_created_at", (q) =>
                q
                  .eq("userId", requireViewerPermission(ctx.viewer, "access_account").userId)
                  .eq("purpose.kind", kind),
              );
    const result = await rows.order("desc").paginate(args.paginationOpts);
    return { ...result, page: await Promise.all(result.page.map((chat) => summary(ctx, chat))) };
  },
});

export const get = publicQuery({
  access: "access_public",
  args: { threadId: v.string() },
  returns: v.union(
    activityValidator.extend({
      isOwner: v.boolean(),
      canControl: v.boolean(),
      sessions: v.array(sessionValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const chat = await visibleChat(ctx, args.threadId, ctx.viewer);
    if (!chat) return null;
    const isOwner = ctx.viewer.kind === "account" && ctx.viewer.userId === chat.userId;
    const sessions = await ctx.db
      .query("scoutBrowserSessions")
      .withIndex("by_thread_id_and_sequence", (q) => q.eq("threadId", chat.threadId))
      .order("asc")
      .take(MAX_BROWSER_SESSIONS_PER_THREAD);
    return {
      ...(await summary(ctx, chat)),
      isOwner,
      canControl:
        ctx.viewer.kind === "account" &&
        isOwner &&
        canAccess(chatPermission(chat.purpose), ctx.viewer.accessKeys),
      sessions: sessions.map(sessionSummary),
    };
  },
});

export const messages = publicQuery({
  access: "access_public",
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      id: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant")),
      text: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const chat = await visibleChat(ctx, args.threadId, ctx.viewer);
    if (!chat) return { page: [], isDone: true, continueCursor: "" };
    const result = await listMessages(ctx, components.agent, args);
    const page = [];
    for (const message of result.page) {
      const content = message.message;
      if (!content || (content.role !== "user" && content.role !== "assistant")) continue;
      const text =
        typeof content.content === "string"
          ? content.content
          : content.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n");
      if (!text.trim()) continue;
      if (content.role === "user") {
        const turn = await ctx.db
          .query("scoutTurns")
          .withIndex("by_thread_id_and_order", (q) =>
            q.eq("threadId", chat.threadId).eq("order", message.order),
          )
          .unique();
        if (turn) {
          const handoff = await ctx.db
            .query("scoutHumanHandoffs")
            .withIndex("by_continuation_turn_id", (q) => q.eq("continuationTurnId", turn._id))
            .unique();
          if (handoff) continue;
        }
      }
      page.push({ id: message._id, role: content.role, text });
    }
    return { ...result, page };
  },
});

export const players = publicQuery({
  access: "access_public",
  args: {},
  returns: v.array(scoutValidator.extend({ busy: v.boolean() })),
  handler: async (ctx) => {
    const scouts = await ctx.db
      .query("scouts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("asc")
      .take(50);
    return await Promise.all(
      scouts.map(async (scout) => ({
        _id: scout._id,
        displayName: scout.displayName,
        status: scout.status,
        busy:
          (await scoutIsWorking(ctx, scout._id)) ||
          Boolean(
            await ctx.db
              .query("scoutBrowserSessions")
              .withIndex("by_scout_id_and_lifecycle_kind", (q) =>
                q.eq("scoutId", scout._id).eq("lifecycle.kind", "active"),
              )
              .first(),
          ) ||
          Boolean(
            await ctx.db
              .query("scoutBrowserSessions")
              .withIndex("by_scout_id_and_lifecycle_kind", (q) =>
                q.eq("scoutId", scout._id).eq("lifecycle.kind", "closing"),
              )
              .first(),
          ),
      })),
    );
  },
});

export const liveView = publicQuery({
  access: "access_public",
  args: { sessionId: v.id("scoutBrowserSessions") },
  returns: v.union(v.object({ url: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (
      !session ||
      session.lifecycle.kind !== "active" ||
      !(await visibleChat(ctx, session.threadId, ctx.viewer))
    )
      return null;
    const view = await ctx.db
      .query("scoutLiveViews")
      .withIndex("by_session_id", (q) => q.eq("sessionId", session._id))
      .unique();
    return view ? { url: requireFirecrawlLiveViewUrl(view.liveViewUrl) } : null;
  },
});
