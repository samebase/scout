import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
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

type ReplaySession = { sessionId: string } | null;
type ReplayPagesResult =
  | { status: "processing" | "unavailable" }
  | {
      status: "ready";
      pages: Awaited<ReturnType<typeof listBrowserReplayPages>>;
    };
type ReplayPlaylistResult =
  | { status: "processing" | "unavailable" }
  | { status: "ready"; playlist: string };

function replayIsProcessing(error: unknown) {
  return error instanceof ProviderHttpError && error.status === 404;
}

export const listPages = action({
  args: {
    domain: v.string(),
    claimKey: v.string(),
  },
  returns: v.union(
    replayNotReadyValidator,
    v.object({
      status: v.literal("ready"),
      pages: v.array(replayPageValidator),
    }),
  ),
  handler: async (ctx, args): Promise<ReplayPagesResult> => {
    const session: ReplaySession = await ctx.runQuery(internal.claimTests.replaySession, args);
    if (!session) return { status: "unavailable" } as const;

    try {
      const pages = await listBrowserReplayPages(session.sessionId);
      return pages.length > 0
        ? ({ status: "ready", pages } as const)
        : ({ status: "processing" } as const);
    } catch (error) {
      if (replayIsProcessing(error)) return { status: "processing" } as const;
      throw new Error("Firecrawl replay could not be loaded");
    }
  },
});

export const loadPlaylist = action({
  args: {
    domain: v.string(),
    claimKey: v.string(),
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
    const session: ReplaySession = await ctx.runQuery(internal.claimTests.replaySession, {
      domain: args.domain,
      claimKey: args.claimKey,
    });
    if (!session) return { status: "unavailable" } as const;

    try {
      return {
        status: "ready",
        playlist: await getBrowserReplayPlaylist(session.sessionId, args.pageId),
      } as const;
    } catch (error) {
      if (replayIsProcessing(error)) return { status: "processing" } as const;
      throw new Error("Firecrawl replay could not be loaded");
    }
  },
});
