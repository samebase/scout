import {
  BufferSource,
  BufferTarget,
  CanvasSource,
  CustomPathedSource,
  HLS_FORMATS,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
  VideoSampleSink,
  canEncodeVideo,
  Quality,
} from "mediabunny";
import { CLICK_COLOR, visibleReplayClicks } from "./browserReplayClicks";
import {
  MAX_REPLAY_EXPORT_BYTES,
  MAX_REPLAY_EXPORT_DURATION_MS,
  REPLAY_EXPORT_FPS,
  type ReplayExportRequest,
} from "./browserReplayExportPlan";

export async function renderBrowserReplay(
  request: ReplayExportRequest,
  onProgress: (progress: number) => void,
) {
  const { width, height, spans, clicks } = request;
  const startMs = spans[0].fromMs;
  const endMs = spans[spans.length - 1].toMs;
  if (endMs <= startMs || endMs - startMs > MAX_REPLAY_EXPORT_DURATION_MS)
    throw new Error(
      `Replay export must be longer than 0 and no longer than ${MAX_REPLAY_EXPORT_DURATION_MS / 60_000} minutes.`,
    );
  const quality = new Quality({ bitrate: 2_000_000 });
  if (!(await canEncodeVideo("avc", { width, height, quality }))) {
    throw new Error(
      "This browser cannot encode H.264 MP4. Try a recent Chrome or Edge on a desktop.",
    );
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create an export canvas.");
  const target = new BufferTarget();
  target.onwrite = (_start, end) => {
    if (end > MAX_REPLAY_EXPORT_BYTES)
      throw new Error(
        `The export exceeds the ${MAX_REPLAY_EXPORT_BYTES / 1024 ** 3} GiB size limit. Choose a shorter recorded tab.`,
      );
  };
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "fragmented" }), target });
  const video = new CanvasSource(canvas, { codec: "avc", quality });
  output.addVideoTrack(video, { frameRate: REPLAY_EXPORT_FPS });
  const totalFrames = Math.ceil(((endMs - startMs) * REPLAY_EXPORT_FPS) / 1_000);
  let frame = 0;
  try {
    await output.start();
    for (const span of spans) {
      const input = new Input({
        formats: HLS_FORMATS,
        source: new CustomPathedSource("replay.m3u8", (path) => {
          if (path.isRoot) return new BufferSource(new TextEncoder().encode(span.playlist));
          const url = new URL(path.path);
          if (url.protocol !== "https:" && url.protocol !== "http:")
            throw new Error("Replay media has an unsupported URL.");
          return new UrlSource(url.href, {
            requestInit: { credentials: "omit" },
            maxCacheSize: 16 * 1024 * 1024,
            getRetryDelay: (attempt) => (attempt < 2 ? 1 : null),
          });
        }),
      });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode()))
          throw new Error("This browser cannot decode the recorded video.");
        const firstTimestamp = await track.getFirstTimestamp();
        const spanEndFrame = Math.min(
          totalFrames,
          Math.ceil(((span.toMs - startMs) * REPLAY_EXPORT_FPS) / 1_000),
        );
        const fromFrame = frame;
        function* timestamps() {
          for (let index = fromFrame; index < spanEndFrame; index++) {
            yield (
              firstTimestamp +
                (startMs + (index * 1_000) / REPLAY_EXPORT_FPS - span.pageStartMs) / 1_000
            );
          }
        }
        const sink = new VideoSampleSink(track);
        for await (const sample of sink.samplesAtTimestamps(timestamps())) {
          if (!sample)
            throw new Error(
              "The recording has a missing video frame. Refresh the replay and try again.",
            );
          try {
            context.fillStyle = "#0a0a0a";
            context.fillRect(0, 0, width, height);
            sample.drawWithFit(context, { fit: "contain" });
            const scale = Math.min(width / sample.displayWidth, height / sample.displayHeight);
            const videoWidth = sample.displayWidth * scale;
            const videoHeight = sample.displayHeight * scale;
            const timeMs = startMs + (frame * 1_000) / REPLAY_EXPORT_FPS;
            for (const click of visibleReplayClicks(clicks, timeMs, span.pageId)) {
              context.save();
              context.globalAlpha = click.opacity;
              context.beginPath();
              context.arc(
                (width - videoWidth) / 2 + click.x * videoWidth,
                (height - videoHeight) / 2 + click.y * videoHeight,
                (click.radius * videoWidth) / 1280,
                0,
                2 * Math.PI,
              );
              context.fillStyle = "#38bdf833";
              context.fill();
              context.strokeStyle = CLICK_COLOR;
              context.lineWidth = (4 * videoWidth) / 1280;
              context.stroke();
              context.restore();
            }
            await video.add(
              frame / REPLAY_EXPORT_FPS,
              Math.min(
                1 / REPLAY_EXPORT_FPS,
                (endMs - startMs) / 1_000 - frame / REPLAY_EXPORT_FPS,
              ),
            );
          } finally {
            sample.close();
          }
          frame++;
          if (frame % REPLAY_EXPORT_FPS === 0) onProgress(frame / totalFrames);
        }
      } finally {
        input.dispose();
      }
    }
    await output.finalize();
    if (!target.buffer) throw new Error("The MP4 could not be finalized.");
    onProgress(1);
    return target.buffer;
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
}
