import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import {
  claimTestBrowserOperationValidator,
  claimTestBrowserSessionLifecycleValidator,
  claimTestBrowserViewportValidator,
} from "./claimTestBrowserModel";
import { getBrowserReplayPlaylist, listBrowserReplayPages } from "./scout/lib/firecrawl";
import { ProviderHttpError } from "./scout/lib/http";

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
  viewport: Infer<typeof claimTestBrowserViewportValidator>;
  lifecycle: Infer<typeof claimTestBrowserSessionLifecycleValidator>;
  operations: Array<Infer<typeof claimTestBrowserOperationValidator>>;
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

function replayIsProcessing(error: unknown) {
  return error instanceof ProviderHttpError && error.status === 404;
}

export const listPages = action({
  args: {
    sessionId: v.id("claimTestBrowserSessions"),
  },
  returns: v.union(
    replayNotReadyValidator,
    v.object({
      status: v.literal("ready"),
      pages: v.array(replayPageValidator),
      viewport: claimTestBrowserViewportValidator,
      lifecycle: claimTestBrowserSessionLifecycleValidator,
      operations: v.array(claimTestBrowserOperationValidator),
    }),
  ),
  handler: async (ctx, args): Promise<ReplayPagesResult> => {
    const replayData = await ctx.runQuery(internal.claimTests.replayData, args);
    if (!replayData) return { status: "unavailable" } as const;

    try {
      const pages = await listBrowserReplayPages(replayData.providerSessionId);
      return pages.length > 0
        ? ({
            status: "ready",
            pages,
            viewport: replayData.viewport,
            lifecycle: replayData.lifecycle,
            operations: replayData.operations,
          } as const)
        : ({ status: "processing" } as const);
    } catch (error) {
      if (replayIsProcessing(error)) return { status: "processing" } as const;
      throw new Error("Firecrawl replay could not be loaded");
    }
  },
});

export const loadPlaylist = action({
  args: {
    sessionId: v.id("claimTestBrowserSessions"),
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
    const replayData = await ctx.runQuery(internal.claimTests.replayData, {
      sessionId: args.sessionId,
    });
    if (!replayData) return { status: "unavailable" } as const;

    try {
      return {
        status: "ready",
        playlist: await getBrowserReplayPlaylist(replayData.providerSessionId, args.pageId),
      } as const;
    } catch (error) {
      if (replayIsProcessing(error)) return { status: "processing" } as const;
      throw new Error("Firecrawl replay could not be loaded");
    }
  },
});
