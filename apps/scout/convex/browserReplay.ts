import { publicAction } from "./functions";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import { browserViewportValidator } from "./browserModel";
import { replayOperationValidator } from "./scout/browserSessions";
import {
  getBrowserReplayPlaylist,
  isFirecrawlReplayNotReady,
  listBrowserReplayPages,
} from "./scout/lib/firecrawlReplay";

const replayPageValidator = v.object({
  pageId: v.string(),
  pageUrl: v.union(v.string(), v.null()),
  startTimeMs: v.number(),
  endTimeMs: v.number(),
});

const replayNotReadyValidator = v.union(
  v.object({ status: v.literal("processing") }),
  v.object({ status: v.literal("unavailable") }),
);

const replaySessionId = v.union(v.id("scoutBrowserSessions"), v.id("agentsApiBrowserSessions"));

type ReplayData = {
  providerSessionId: string;
  viewport: Infer<typeof browserViewportValidator>;
  operations: Array<Infer<typeof replayOperationValidator>>;
} | null;
type ReplayPagesResult =
  | { status: "processing" | "unavailable" }
  | {
      status: "ready";
      pages: Awaited<ReturnType<typeof listBrowserReplayPages>>;
      viewport: { width: number; height: number };
      operations: NonNullable<ReplayData>["operations"];
    };
type ReplayPlaylistResult =
  | { status: "processing" | "unavailable" }
  | { status: "ready"; playlist: string };

export const listPages = publicAction({
  access: "access_public",
  args: { sessionId: replaySessionId },
  returns: v.union(
    replayNotReadyValidator,
    v.object({
      status: v.literal("ready"),
      pages: v.array(replayPageValidator),
      viewport: browserViewportValidator,
      operations: v.array(replayOperationValidator),
    }),
  ),
  handler: async (ctx, args): Promise<ReplayPagesResult> => {
    const replayData = await ctx.runQuery(internal.browserReplay.data, args);
    if (!replayData) return { status: "unavailable" };

    try {
      const pages = await listBrowserReplayPages(replayData.providerSessionId);
      if (pages.length === 0) return { status: "processing" };
      return {
        status: "ready",
        pages,
        viewport: replayData.viewport,
        operations: replayData.operations,
      };
    } catch (error) {
      if (isFirecrawlReplayNotReady(error)) return { status: "processing" };
      throw new Error("Firecrawl replay could not be loaded");
    }
  },
});

export const loadPlaylist = publicAction({
  access: "access_public",
  args: {
    sessionId: replaySessionId,
    pageId: v.string(),
  },
  returns: v.union(
    replayNotReadyValidator,
    v.object({
      status: v.literal("ready"),
      playlist: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<ReplayPlaylistResult> => {
    const replayData = await ctx.runQuery(internal.browserReplay.data, {
      sessionId: args.sessionId,
    });
    if (!replayData) return { status: "unavailable" };

    try {
      return {
        status: "ready",
        playlist: await getBrowserReplayPlaylist(replayData.providerSessionId, args.pageId),
      };
    } catch (error) {
      if (isFirecrawlReplayNotReady(error)) return { status: "processing" };
      throw new Error("Firecrawl replay could not be loaded");
    }
  },
});

export const data = internalQuery({
  args: { sessionId: replaySessionId },
  returns: v.union(
    v.object({
      providerSessionId: v.string(),
      viewport: browserViewportValidator,
      operations: v.array(replayOperationValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<ReplayData> => {
    const agentsId = ctx.db.normalizeId("agentsApiBrowserSessions", args.sessionId);
    let replayData;
    if (agentsId) {
      replayData = await ctx.runQuery(internal.agentsApi.browsers.replayData, {
        sessionId: agentsId,
      });
    } else {
      const scoutId = ctx.db.normalizeId("scoutBrowserSessions", args.sessionId);
      if (!scoutId) return null;
      replayData = await ctx.runQuery(internal.scout.browserSessions.replayData, {
        sessionId: scoutId,
      });
    }
    if (!replayData) return null;
    return {
      providerSessionId: replayData.providerSessionId,
      viewport: replayData.viewport,
      operations: replayData.operations,
    };
  },
});
