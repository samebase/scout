import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import {
  taskBrowserOperationStateValidator,
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

const replaySourceValidator = v.union(
  v.object({ kind: v.literal("task"), sessionId: v.id("taskBrowserSessions") }),
  v.object({ kind: v.literal("lab"), sessionId: v.id("scoutLabBrowserSessions") }),
);

const replayOperationValidator = v.object({
  sequence: v.number(),
  state: taskBrowserOperationStateValidator,
});

type ReplayData = {
  providerSessionId: string;
  viewport: Infer<typeof taskBrowserViewportValidator>;
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

export const listPages = action({
  args: { source: replaySourceValidator },
  returns: v.union(
    replayNotReadyValidator,
    v.object({
      status: v.literal("ready"),
      pages: v.array(replayPageValidator),
      viewport: taskBrowserViewportValidator,
      operations: v.array(replayOperationValidator),
    }),
  ),
  handler: async (ctx, args): Promise<ReplayPagesResult> => {
    const replayData = await loadReplayData(ctx, args.source);
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

export const loadPlaylist = action({
  args: {
    source: replaySourceValidator,
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
    const replayData = await loadReplayData(ctx, args.source);
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

async function loadReplayData(
  ctx: ActionCtx,
  source: Infer<typeof replaySourceValidator>,
): Promise<ReplayData> {
  const replayData =
    source.kind === "task"
      ? await ctx.runQuery(internal.tasks.replayData, { sessionId: source.sessionId })
      : await ctx.runQuery(internal.scout.labBrowserSessions.replayData, {
          sessionId: source.sessionId,
        });
  if (!replayData) return null;
  return {
    providerSessionId: replayData.providerSessionId,
    viewport: replayData.viewport,
    operations: replayData.operations.map(({ sequence, state }) => ({ sequence, state })),
  };
}
