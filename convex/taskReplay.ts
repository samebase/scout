import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import {
  taskBrowserOperationValidator,
  taskBrowserSessionLifecycleValidator,
  taskBrowserViewportValidator,
} from "./taskBrowserModel";
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

type ReplayData = {
  providerSessionId: string;
  viewport: Infer<typeof taskBrowserViewportValidator>;
  lifecycle: Infer<typeof taskBrowserSessionLifecycleValidator>;
  operations: Array<Infer<typeof taskBrowserOperationValidator>>;
} | null;
type ReplayPagesResult =
  | { status: "processing" | "unavailable" }
  | {
      status: "ready";
      pages: Awaited<ReturnType<typeof listBrowserReplayPages>>;
      viewport: { width: number; height: number };
      lifecycle: NonNullable<ReplayData>["lifecycle"];
      operations: NonNullable<ReplayData>["operations"];
    };
type ReplayPlaylistResult =
  | { status: "processing" | "unavailable" }
  | { status: "ready"; playlist: string };

export const listPages = action({
  args: {
    sessionId: v.id("taskBrowserSessions"),
  },
  returns: v.union(
    replayNotReadyValidator,
    v.object({
      status: v.literal("ready"),
      pages: v.array(replayPageValidator),
      viewport: taskBrowserViewportValidator,
      lifecycle: taskBrowserSessionLifecycleValidator,
      operations: v.array(taskBrowserOperationValidator),
    }),
  ),
  handler: async (ctx, args): Promise<ReplayPagesResult> => {
    const replayData = await ctx.runQuery(internal.tasks.replayData, args);
    if (!replayData) return { status: "unavailable" };

    try {
      const pages = await listBrowserReplayPages(replayData.providerSessionId);
      if (pages.length === 0) return { status: "processing" };
      return {
        status: "ready",
        pages,
        viewport: replayData.viewport,
        lifecycle: replayData.lifecycle,
        operations: replayData.operations,
      };
    } catch (error) {
      if (isFirecrawlReplayNotReady(error)) return { status: "processing" };
      throw new Error("Firecrawl replay could not be loaded");
    }
  },
});

export const loadPlaylist = action({
  args: {
    sessionId: v.id("taskBrowserSessions"),
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
    const replayData = await ctx.runQuery(internal.tasks.replayData, {
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
