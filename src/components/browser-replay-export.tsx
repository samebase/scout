import { useAction } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import type { ReplayClick } from "#lib/browserReplayClicks";
import type { ReplayTimeline } from "#lib/browserReplayTimeline";
import {
  replayExportMessageSchema,
  replayExportSpans,
  type ReplayExportRequest,
} from "#lib/browserReplayExportPlan";

type ExportState =
  | { kind: "idle" }
  | { kind: "exporting"; progress: number }
  | { kind: "ready"; url: string }
  | { kind: "failed"; message: string };

export function BrowserReplayExport({
  sessionId,
  timeline,
  manualPageId,
  viewport,
  clicks,
}: {
  sessionId: FunctionArgs<typeof api.browserReplay.loadPlaylist>["sessionId"];
  timeline: ReplayTimeline;
  manualPageId: string | null;
  viewport: { width: number; height: number };
  clicks: ReplayClick[];
}) {
  const loadPlaylist = useAction(api.browserReplay.loadPlaylist);
  const [state, setState] = useState<ExportState>({ kind: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const runRef = useRef(0);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      runRef.current++;
      workerRef.current?.terminate();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const cancel = () => {
    runRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setState({ kind: "idle" });
  };

  const start = async () => {
    const run = ++runRef.current;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setState({ kind: "exporting", progress: 0 });
    try {
      const spans = replayExportSpans(timeline, manualPageId);
      const playlists = new Map<string, string>();
      for (const pageId of new Set(spans.map((span) => span.pageId))) {
        const result = await loadPlaylist({ sessionId, pageId });
        if (run !== runRef.current) return;
        if (result.status !== "ready")
          throw new Error("The recording is not ready. Refresh the replay and try again.");
        playlists.set(pageId, result.playlist);
      }
      const request: ReplayExportRequest = {
        ...viewport,
        clicks,
        spans: spans.map((span) => {
          const playlist = playlists.get(span.pageId);
          if (!playlist) throw new Error("A recorded tab could not be loaded.");
          return { ...span, playlist };
        }),
      };
      const worker = new Worker(new URL("../lib/browserReplayExport.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (run !== runRef.current) return;
        const parsed = replayExportMessageSchema.safeParse(event.data);
        if (!parsed.success) {
          worker.terminate();
          workerRef.current = null;
          setState({ kind: "failed", message: "The video exporter returned an invalid result." });
          return;
        }
        const message = parsed.data;
        if (message.kind === "progress") {
          setState({ kind: "exporting", progress: message.progress });
          return;
        }
        worker.terminate();
        workerRef.current = null;
        if (message.kind === "failed") setState({ kind: "failed", message: message.message });
        else {
          const url = URL.createObjectURL(new Blob([message.buffer], { type: "video/mp4" }));
          urlRef.current = url;
          setState({ kind: "ready", url });
        }
      };
      worker.onerror = () => {
        if (run !== runRef.current) return;
        worker.terminate();
        workerRef.current = null;
        setState({
          kind: "failed",
          message: "The video exporter stopped. Try a recent desktop Chrome or Edge.",
        });
      };
      worker.postMessage(request);
    } catch (error) {
      if (run === runRef.current)
        setState({
          kind: "failed",
          message: error instanceof Error ? error.message : "The replay export failed.",
        });
    }
  };

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {state.kind === "exporting" ? (
          <>
            <span className="flex items-center gap-2 text-xs" role="status">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Exporting {Math.round(state.progress * 100)}%
            </span>
            <Button size="xs" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="xs" variant="outline" onClick={() => void start()}>
            <DownloadIcon />
            {manualPageId ? "Export tab MP4" : "Export MP4"}
          </Button>
        )}
        {state.kind === "ready" ? (
          <a
            href={state.url}
            download={`scout-replay-${sessionId}.mp4`}
            className="text-xs font-medium text-primary underline"
          >
            Download MP4
          </a>
        ) : null}
      </div>
      <p
        className="mt-2 text-[11px] leading-4 text-muted-foreground"
        role={state.kind === "failed" ? "alert" : undefined}
      >
        {state.kind === "failed"
          ? state.message
          : state.kind === "exporting"
            ? "Keep this replay open while it exports. Closing or refreshing cancels the export."
            : "Exports the selected view with visible click rings baked in. Silent MP4, original speed, up to 10 minutes / 100 MB. Processed on this device."}
      </p>
    </div>
  );
}
