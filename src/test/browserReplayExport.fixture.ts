import {
  replayExportMessageSchema,
  replayExportRequestSchema,
} from "../lib/browserReplayExportPlan";

const input = document.createElement("textarea");
input.id = "export-request";
const button = document.createElement("button");
button.textContent = "Run export proof";
const status = document.createElement("p");
status.id = "export-status";
document.body.replaceChildren(input, button, status);
button.onclick = () => {
  const request = replayExportRequestSchema.parse(JSON.parse(input.value));
  const worker = new Worker(new URL("../lib/browserReplayExport.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<unknown>) => {
    const message = replayExportMessageSchema.parse(event.data);
    if (message.kind === "progress") {
      status.textContent = `${message.progress}`;
      return;
    }
    worker.terminate();
    if (message.kind === "failed") {
      status.textContent = message.message;
      return;
    }
    const link = document.createElement("a");
    link.textContent = "Download proof";
    link.download = "scout-click-proof.mp4";
    link.href = URL.createObjectURL(new Blob([message.buffer], { type: "video/mp4" }));
    const video = document.createElement("video");
    video.src = link.href;
    video.controls = true;
    video.width = 960;
    document.body.append(link, video);
    status.textContent = "Export complete";
  };
  worker.onerror = (event) => {
    status.textContent = event.message;
    worker.terminate();
  };
  worker.postMessage(request);
};
