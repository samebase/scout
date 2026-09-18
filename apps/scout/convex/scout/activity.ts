import { getThreadMetadata, listMessages } from "@convex-dev/agent";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { publicQuery, query } from "../functions";
import { requireViewerPermission } from "../access";
import { siteHostnameSchema } from "../../shared/site";
import { omitNullish } from "../../shared/omitNullish";
import { canAccess } from "../../shared/accessModel";
import { chatPermission, visibleChat } from "./chatAccess";
import { availabilityValidator, scoutReservation } from "./availability";
import type { ViewerAccess } from "../access";
import { getInitialCheck } from "../tasks/requestChecks";
import { walkthroughContent } from "../tasks/screenshotModel";
import { chatPurposeValidator, chatVisibilityValidator } from "./chatModel";
import { MAX_BROWSER_SESSIONS_PER_THREAD } from "./browserSessions";
import { requireFirecrawlLiveViewUrl } from "./lib/firecrawlLiveView";
import {
  memberTranscriptItemValidator,
  type MemberTranscriptItem,
} from "../../shared/toolActivity";
import { agentsToolActivity } from "./toolActivityAgents";
import { convexToolActivities } from "./toolActivityConvex";

const scoutValidator = v.object({
  _id: v.id("scouts"),
  displayName: v.string(),
  status: v.union(v.literal("active"), v.literal("disabled")),
});
const sessionFields = {
  createdAt: v.number(),
  kind: v.union(v.literal("active"), v.literal("closing"), v.literal("closed")),
};
const sessionValidator = v.union(
  v.object({
    ...sessionFields,
    engine: v.literal("convex_agent"),
    sessionId: v.id("scoutBrowserSessions"),
  }),
  v.object({
    ...sessionFields,
    engine: v.literal("agents_api"),
    sessionId: v.id("agentsApiBrowserSessions"),
  }),
);
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
  primarySite: v.union(v.string(), v.null()),
  createdAt: v.number(),
  purpose: chatPurposeValidator,
  visibility: chatVisibilityValidator,
  scout: scoutValidator,
  status: statusValidator,
  latestSession: v.union(sessionValidator, v.null()),
  walkthrough: v.union(walkthroughContent.pick("summary", "checks"), v.null()),
});

const MAX_FEED_ROWS = 24;
const MAX_FEED_BYTES = 256 * 1024;

export const currentActivityValidator = v.union(
  v.object({ kind: v.literal("private") }),
  v.object({
    kind: v.literal("visible"),
    activity: activityValidator,
    destination: v.union(
      v.object({
        to: v.literal("/agents"),
        search: v.object({ session: v.id("agentsApiSessions") }),
      }),
      v.object({ to: v.literal("/review"), search: v.object({ thread: v.string() }) }),
      v.object({ to: v.literal("/play"), search: v.object({ thread: v.string() }) }),
    ),
  }),
  v.null(),
);

export async function currentScoutActivity(
  ctx: QueryCtx,
  scout: Doc<"scouts">,
  reservation: Awaited<ReturnType<typeof scoutReservation>>,
  viewer: ViewerAccess,
): Promise<typeof currentActivityValidator.type> {
  if (!reservation) return null;
  const threadId =
    reservation.kind === "agents_api" ? reservation.session._id : reservation.threadId;
  const chat = await ctx.db
    .query("scoutChats")
    .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
    .unique();
  const canInspect = viewer.kind === "account" && canAccess("access_lab", viewer.accessKeys);
  const visible = await visibleChat(ctx, threadId, viewer);

  if (reservation.kind === "agents_api") {
    if (!canInspect && !visible) return { kind: "private" };
    const session = reservation.session;
    const activity = chat
      ? await summary(ctx, chat)
      : {
          threadId,
          title: session.title,
          primarySite: null,
          createdAt: session._creationTime,
          purpose: { kind: "general" as const },
          visibility: "private" as const,
          status: managedStatus(session),
          scout: { _id: scout._id, displayName: scout.displayName, status: scout.status },
          latestSession: null,
          walkthrough: null,
        };
    return {
      kind: "visible",
      activity: { ...activity, latestSession: visible ? activity.latestSession : null },
      destination: canInspect
        ? { to: "/agents", search: { session: session._id } }
        : { to: chat?.purpose.kind === "play" ? "/play" : "/review", search: { thread: threadId } },
    };
  }

  if (!visible || !chat || chat.purpose.kind === "general") return { kind: "private" };
  return {
    kind: "visible",
    activity: await summary(ctx, chat),
    destination: {
      to: chat.purpose.kind === "play" ? "/play" : "/review",
      search: { thread: threadId },
    },
  };
}

function sessionSummary(session: Doc<"scoutBrowserSessions">) {
  return {
    engine: "convex_agent" as const,
    sessionId: session._id,
    createdAt: session._creationTime,
    kind: session.lifecycle.kind,
  };
}

function managedStatus(session: Doc<"agentsApiSessions">): typeof statusValidator.type {
  switch (session.state.kind) {
    case "starting":
    case "checking":
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "idle":
      return "finished";
    case "stopped":
      return session.active ? "stopping" : "stopped";
    case "failed":
      return "failed";
  }
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
  const managedId = chat.runtime?.kind === "agents_api" ? chat.runtime.sessionId : null;
  if (managedId) {
    const [managed, scout, browser] = await Promise.all([
      ctx.db.get(managedId),
      ctx.db.get(chat.scoutId),
      ctx.db
        .query("agentsApiBrowserSessions")
        .withIndex("by_agents_session_id_and_sequence", (q) => q.eq("agentsSessionId", managedId))
        .order("desc")
        .first(),
    ]);
    if (!managed || !scout) throw new Error("Review session not found");
    return {
      threadId: chat.threadId,
      title: managed.title,
      primarySite: chat.primarySite ?? null,
      createdAt: chat.createdAt,
      purpose: chat.purpose,
      visibility: chat.visibility,
      status: managedStatus(managed),
      scout: { _id: scout._id, displayName: scout.displayName, status: scout.status },
      latestSession: browser
        ? {
            engine: "agents_api" as const,
            sessionId: browser._id,
            createdAt: browser._creationTime,
            kind: browser.lifecycle.kind,
          }
        : null,
      walkthrough: managed.walkthrough
        ? {
            summary: managed.walkthrough.summary,
            ...omitNullish({ checks: managed.walkthrough.checks }),
          }
        : null,
    };
  }
  const [thread, scout, status, session] = await Promise.all([
    getThreadMetadata(ctx, components.agent, { threadId: chat.threadId }),
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
    primarySite: chat.primarySite ?? null,
    createdAt: chat.createdAt,
    purpose: chat.purpose,
    visibility: chat.visibility,
    status,
    scout: { _id: scout._id, displayName: scout.displayName, status: scout.status },
    latestSession: session ? sessionSummary(session) : null,
    walkthrough: null,
  };
}

export const list = publicQuery({
  access: "access_public",
  args: {
    site: v.union(v.string(), v.null()),
    scope: v.union(v.literal("public"), v.literal("mine")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(activityValidator),
  handler: async (ctx, args) => {
    const site = args.site === null ? null : siteHostnameSchema.parse(args.site);
    const userId =
      args.scope === "mine" ? requireViewerPermission(ctx.viewer, "access_account").userId : null;
    const rows =
      userId === null
        ? site === null
          ? ctx.db
              .query("scoutChats")
              .withIndex("by_public_site_eligible_and_created_at", (q) =>
                q.eq("publicSiteEligible", true),
              )
          : ctx.db
              .query("scoutChats")
              .withIndex("by_public_site_eligible_and_primary_site_and_created_at", (q) =>
                q.eq("publicSiteEligible", true).eq("primarySite", site),
              )
        : site === null
          ? ctx.db
              .query("scoutChats")
              .withIndex("by_user_id_and_purpose_kind_and_created_at", (q) =>
                q.eq("userId", userId).eq("purpose.kind", "review"),
              )
          : ctx.db
              .query("scoutChats")
              .withIndex("by_user_id_and_purpose_kind_and_primary_site_and_created_at", (q) =>
                q.eq("userId", userId).eq("purpose.kind", "review").eq("primarySite", site),
              );
    // Bound both initial and reactive pages without discarding native cursor/split options.
    const result = await rows.order("desc").paginate({
      ...args.paginationOpts,
      numItems: Math.min(args.paginationOpts.numItems, MAX_FEED_ROWS),
      maximumRowsRead: Math.min(
        args.paginationOpts.maximumRowsRead ?? MAX_FEED_ROWS,
        MAX_FEED_ROWS,
      ),
      maximumBytesRead: Math.min(
        args.paginationOpts.maximumBytesRead ?? MAX_FEED_BYTES,
        MAX_FEED_BYTES,
      ),
    });
    const page = await Promise.all(result.page.map((chat) => summary(ctx, chat)));
    return { ...result, page };
  },
});

export const unassigned = query({
  access: "access_account",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(activityValidator),
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db
      .query("scoutChats")
      .withIndex("by_user_id_and_purpose_kind_and_primary_site_and_created_at", (q) =>
        q.eq("userId", ctx.viewer.userId).eq("purpose.kind", "review").eq("primarySite", undefined),
      )
      .order("desc")
      .paginate({
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, MAX_FEED_ROWS),
        maximumRowsRead: Math.min(paginationOpts.maximumRowsRead ?? MAX_FEED_ROWS, MAX_FEED_ROWS),
        maximumBytesRead: Math.min(
          paginationOpts.maximumBytesRead ?? MAX_FEED_BYTES,
          MAX_FEED_BYTES,
        ),
      });
    const page = await Promise.all(result.page.map((chat) => summary(ctx, chat)));
    return { ...result, page };
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
      runtime: v.union(
        v.object({ kind: v.literal("task"), sessionId: v.id("agentsApiSessions") }),
        v.object({ kind: v.literal("convex_agent") }),
      ),
      hasWalkthrough: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const chat = await visibleChat(ctx, args.threadId, ctx.viewer);
    if (!chat) return null;
    const isOwner = ctx.viewer.kind === "account" && ctx.viewer.userId === chat.userId;
    const managedId = chat.runtime?.kind === "agents_api" ? chat.runtime.sessionId : null;
    const sessions = managedId
      ? (
          await ctx.db
            .query("agentsApiBrowserSessions")
            .withIndex("by_agents_session_id_and_sequence", (q) =>
              q.eq("agentsSessionId", managedId),
            )
            .order("asc")
            .take(MAX_BROWSER_SESSIONS_PER_THREAD)
        ).map((browser) => ({
          engine: "agents_api" as const,
          sessionId: browser._id,
          createdAt: browser._creationTime,
          kind: browser.lifecycle.kind,
        }))
      : (
          await ctx.db
            .query("scoutBrowserSessions")
            .withIndex("by_thread_id_and_sequence", (q) => q.eq("threadId", chat.threadId))
            .order("asc")
            .take(MAX_BROWSER_SESSIONS_PER_THREAD)
        ).map(sessionSummary);
    return {
      ...(await summary(ctx, chat)),
      isOwner,
      canControl:
        managedId !== null &&
        ctx.viewer.kind === "account" &&
        isOwner &&
        canAccess(chatPermission(chat.purpose), ctx.viewer.accessKeys),
      sessions,
      runtime: managedId
        ? { kind: "task" as const, sessionId: managedId }
        : { kind: "convex_agent" as const },
      hasWalkthrough: managedId ? Boolean((await ctx.db.get(managedId))?.walkthrough) : false,
    };
  },
});

export const messages = publicQuery({
  access: "access_public",
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(memberTranscriptItemValidator),
  handler: async (ctx, args) => {
    const chat = await visibleChat(ctx, args.threadId, ctx.viewer);
    if (!chat) return { page: [], isDone: true, continueCursor: "" };
    const managedId = chat.runtime?.kind === "agents_api" ? chat.runtime.sessionId : null;
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(args.paginationOpts.numItems, 50),
      maximumRowsRead: Math.min(args.paginationOpts.maximumRowsRead ?? 100, 100),
      maximumBytesRead: Math.min(args.paginationOpts.maximumBytesRead ?? 1_000_000, 1_000_000),
    };
    if (managedId) {
      const session = await ctx.db.get(managedId);
      if (!session) throw new Error("Session not found");
      const result = await ctx.db
        .query("agentsApiItems")
        .withIndex("by_session_id_and_sequence", (q) => q.eq("sessionId", managedId))
        .order("desc")
        .paginate(paginationOpts);
      if (args.paginationOpts.cursor === null && result.isDone && result.page.length === 0) {
        const check = await getInitialCheck(ctx, managedId);
        return {
          ...result,
          page: check
            ? [
                {
                  kind: "message" as const,
                  id: check._id,
                  role: "user" as const,
                  text: check.prompt,
                },
              ]
            : [],
        };
      }
      const rows = await Promise.all(
        result.page.map(async (item): Promise<MemberTranscriptItem[]> => {
          if ((item.kind === "user" || item.kind === "assistant") && item.text.trim()) {
            return [{ kind: "message", id: item._id, role: item.kind, text: item.text }];
          }
          const tool = await agentsToolActivity(ctx, session, item, "member");
          return tool ? [{ kind: "tool", id: tool.id, tool }] : [];
        }),
      );
      return { ...result, page: rows.flat() };
    }
    const result = await listMessages(ctx, components.agent, { ...args, paginationOpts });
    const tools = await convexToolActivities(ctx, result.page);
    const page: MemberTranscriptItem[] = [];
    for (const message of result.page) {
      for (const tool of (tools.get(message._id) ?? []).toReversed()) {
        page.push({ kind: "tool", id: tool.id, tool });
      }
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
      page.push({ kind: "message", id: message._id, role: content.role, text });
    }
    return { ...result, page };
  },
});

export const players = publicQuery({
  access: "access_public",
  args: {},
  returns: v.array(
    scoutValidator.extend({ busy: v.boolean(), availability: availabilityValidator }),
  ),
  handler: async (ctx) => {
    const scouts = await ctx.db
      .query("scouts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("asc")
      .take(50);
    return await Promise.all(
      scouts.map(async (scout) => {
        const reservation = await scoutReservation(ctx, scout._id);
        return {
          _id: scout._id,
          displayName: scout.displayName,
          status: scout.status,
          busy: reservation !== null,
          availability: reservation?.status ?? ("available" as const),
        };
      }),
    );
  },
});

export const liveView = publicQuery({
  access: "access_public",
  args: { sessionId: v.union(v.id("scoutBrowserSessions"), v.id("agentsApiBrowserSessions")) },
  returns: v.union(v.object({ url: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const managedId = ctx.db.normalizeId("agentsApiBrowserSessions", args.sessionId);
    if (managedId) {
      const browser = await ctx.db.get(managedId);
      if (
        !browser ||
        browser.lifecycle.kind !== "active" ||
        !(await visibleChat(ctx, browser.agentsSessionId, ctx.viewer))
      )
        return null;
      const session = await ctx.db.get(browser.agentsSessionId);
      const handle = session?.browser;
      return handle?.providerSessionId === browser.providerSessionId && handle.liveViewUrl
        ? { url: requireFirecrawlLiveViewUrl(handle.liveViewUrl) }
        : null;
    }
    const oldId = ctx.db.normalizeId("scoutBrowserSessions", args.sessionId);
    const session = oldId ? await ctx.db.get(oldId) : null;
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
