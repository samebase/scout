import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite-plus";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { BrowserClickRecorder } from "../../convex/scout/browserClickRecorder";
import { omitNullish } from "../../shared/omitNullish";

test.skipIf(process.env["SCOUT_RUN_REPLAY_PROOF"] !== "true")(
  "bakes real browser clicks into an HLS-to-MP4 export",
  async () => {
    const artifacts =
      process.env["SCOUT_REPLAY_PROOF_DIR"] ??
      (await mkdtemp(join(tmpdir(), "scout-replay-proof-")));
    const server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL("../../", import.meta.url)),
      cacheDir: join(artifacts, ".vite"),
      logLevel: "error",
      server: { host: "127.0.0.1", port: 5189, strictPort: true },
      plugins: [
        {
          name: "replay-proof-fixture",
          configureServer(vite) {
            vite.middlewares.use((request, response, next) => {
              if (request.url === "/" || request.url === "/next") {
                response.setHeader("Content-Type", "text/html");
                response.end(
                  `<html><body style="margin:0;background:#101620;color:#eee;font:24px system-ui"><h1 style="position:absolute;left:90px;top:100px">Scout replay proof</h1><p style="position:absolute;left:90px;top:180px">Two real browser clicks, recorded and baked into MP4.</p><button style="position:absolute;left:240px;top:340px;width:160px;height:120px;font:24px system-ui">First action</button><button style="position:absolute;left:820px;top:340px;width:160px;height:120px;font:24px system-ui">Next action</button><input aria-label="Private input" style="position:absolute;left:90px;top:600px"><iframe srcdoc="<button>Embedded action</button>" style="position:absolute;left:500px;top:600px"></iframe></body></html>`,
                );
                return;
              }
              if (request.url === "/export") {
                response.setHeader("Content-Type", "text/html");
                response.end(
                  '<html><body><script type="module" src="/src/test/browserReplayExport.fixture.ts"></script></body></html>',
                );
                return;
              }
              const filename = request.url?.match(/^\/media\/(source\d+\.(?:ts|m3u8))$/)?.[1];
              if (filename) {
                void readFile(join(artifacts, filename))
                  .then((buffer) => {
                    response.setHeader(
                      "Content-Type",
                      filename.endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl",
                    );
                    response.end(buffer);
                  })
                  .catch(() => {
                    response.statusCode = 404;
                    response.end();
                  });
                return;
              }
              next();
            });
          },
        },
      ],
    });
    await server.listen();
    const origin = server.resolvedUrls?.local[0];
    if (!origin) throw new Error("The proof server did not start");
    const browser = await chromium.launch(
      omitNullish({ executablePath: process.env["SCOUT_REPLAY_PROOF_CHROMIUM"], headless: true }),
    );
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        recordVideo: { dir: artifacts, size: { width: 1280, height: 800 } },
      });
      const recordingStartMs = Date.now();
      const page = await context.newPage();
      await page.goto(origin);
      const recorder = new BrowserClickRecorder(context);
      await recorder.start();
      await page.getByLabel("Private input").fill("this must not be in click telemetry");
      await page.evaluate(() =>
        document.body.dispatchEvent(
          new PointerEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }),
        ),
      );
      await page.frameLocator("iframe").getByRole("button").click();
      await new Promise((resolve) => setTimeout(resolve, 600));
      await page.mouse.click(320, 400);
      await new Promise((resolve) => setTimeout(resolve, 900));
      await page.goto(`${origin}next`);
      await page.mouse.click(900, 400);
      await new Promise((resolve) => setTimeout(resolve, 900));
      const capture = await recorder.finish();
      expect(capture.kind).toBe("captured");
      if (capture.kind !== "captured") throw new Error("Real click capture was unavailable");
      expect(capture.incomplete).toBe(false);
      expect(capture.clicks).toHaveLength(2);
      expect(capture.clicks.map(({ x, y }) => ({ x, y }))).toEqual([
        { x: 0.25, y: 0.5 },
        { x: 900 / 1280, y: 0.5 },
      ]);
      expect(JSON.stringify(capture)).not.toContain("this must not");
      const followup = new BrowserClickRecorder(context);
      await followup.start();
      await page.mouse.click(320, 400);
      const secondCapture = await followup.finish();
      expect(secondCapture).toMatchObject({ kind: "captured", clicks: [{ x: 0.25, y: 0.5 }] });
      await page.mouse.click(320, 400);
      expect(capture.clicks).toHaveLength(2);
      const recording = page.video();
      if (!recording) throw new Error("Playwright did not record video");
      await context.close();
      const rawPath = await recording.path();
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        rawPath,
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        "-hls_time",
        "1",
        "-hls_playlist_type",
        "vod",
        "-hls_flags",
        "program_date_time",
        "-hls_segment_filename",
        join(artifacts, "source%d.ts"),
        join(artifacts, "source0.m3u8"),
      ]);
      const playlist = (await readFile(join(artifacts, "source0.m3u8"), "utf8")).replace(
        /^(source\d+\.ts)$/gm,
        `${origin}media/$1`,
      );
      const durationMs =
        z.coerce
          .number()
          .positive()
          .parse(
            execFileSync(
              "ffprobe",
              [
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1:nk=1",
                rawPath,
              ],
              { encoding: "utf8" },
            ).trim(),
          ) * 1000;
      const clicks = capture.clicks.map((click, index) => ({
        id: `click-${index}`,
        pageId: "1",
        timeMs: click.atMs - recordingStartMs,
        x: click.x,
        y: click.y,
      }));
      const exported = await browser.newPage();
      const errors: string[] = [];
      exported.on("pageerror", (error) => errors.push(error.message));
      await exported.goto(`${origin}export`);
      await exported.locator("#export-request").fill(
        JSON.stringify({
          width: 1280,
          height: 800,
          spans: [{ pageId: "1", playlist, fromMs: 0, toMs: durationMs, pageStartMs: 0 }],
          clicks,
        }),
      );
      await exported.getByRole("button", { name: "Run export proof" }).click();
      try {
        await exported.getByRole("link", { name: "Download proof" }).waitFor({ timeout: 30_000 });
      } catch {
        throw new Error(
          `Export failed: ${await exported.locator("#export-status").textContent()}; ${errors.join("; ")}`,
        );
      }
      expect(errors).toEqual([]);
      const downloadEvent = exported.waitForEvent("download");
      await exported.getByRole("link", { name: "Download proof" }).click();
      const outputPath = join(artifacts, "scout-click-proof.mp4");
      await (await downloadEvent).saveAs(outputPath);
      const metadata = await exported.evaluate(async () => {
        const video = document.querySelector("video");
        if (!video) throw new Error("The exported video was not mounted");
        await video.play();
        video.pause();
        return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
      });
      expect(metadata).toMatchObject({ width: 1280, height: 800 });
      expect(metadata.duration).toBeCloseTo(durationMs / 1000, 1);
      for (const [index, click] of clicks.entries()) {
        const time = (click.timeMs + 200) / 1000;
        const pixels = execFileSync(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            String(time),
            "-i",
            outputPath,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
          ],
          { maxBuffer: 5_000_000 },
        );
        let bluePixels = 0;
        for (let y = 375; y < 425; y++)
          for (let x = Math.round(click.x * 1280) - 25; x < click.x * 1280 + 25; x++) {
            const offset = (y * 1280 + x) * 3;
            if (pixels[offset] < 140 && pixels[offset + 1] > 120 && pixels[offset + 2] > 170)
              bluePixels++;
          }
        expect(bluePixels).toBeGreaterThan(50);
        execFileSync("ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          String(time),
          "-i",
          outputPath,
          "-frames:v",
          "1",
          join(artifacts, `baked-click-${index + 1}.png`),
        ]);
      }
      await writeFile(
        join(artifacts, "capture.json"),
        JSON.stringify({ capture, recordingStartMs, durationMs, metadata }, null, 2),
      );
      console.log(`Verified MP4 and baked click frames: ${outputPath}`);
    } finally {
      await browser.close();
      await server.close();
    }
  },
  60_000,
);
