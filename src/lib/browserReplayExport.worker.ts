import { replayExportRequestSchema, type ReplayExportMessage } from "./browserReplayExportPlan";
import { renderBrowserReplay } from "./renderBrowserReplay";

function send(message: ReplayExportMessage, transfer: Transferable[] = []) {
  globalThis.postMessage(message, { transfer });
}

async function exportReplay(event: MessageEvent<unknown>) {
  try {
    const request = replayExportRequestSchema.parse(event.data);
    const buffer = await renderBrowserReplay(request, (progress) =>
      send({ kind: "progress", progress }),
    );
    send({ kind: "done", buffer }, [buffer]);
  } catch (error) {
    send({
      kind: "failed",
      message: error instanceof Error ? error.message : "The replay export failed.",
    });
  }
}

globalThis.addEventListener(
  "message",
  (event: MessageEvent<unknown>) => {
    void exportReplay(event);
  },
  { once: true },
);
