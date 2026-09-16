import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { downloadFirecrawlScreenshot, MAX_SITE_PREVIEW_BYTES } from "./firecrawlScreenshot";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const url = "https://storage.googleapis.com/firecrawl-media/screenshot.png?signature=example";
const fetchImage = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchImage
    .mockReset()
    .mockImplementation(
      async () => new Response(png, { headers: { "content-type": "image/png" } }),
    );
  vi.stubGlobal("fetch", fetchImage);
});
afterEach(() => vi.unstubAllGlobals());

test.each([
  "https://evil.test/image.png",
  "https://storage.googleapis.com.evil.test/bucket/image.png",
  "https://storage.googleapis.com@evil.test/bucket/image.png",
  "https://user:password@storage.googleapis.com/bucket/image.png",
  "http://storage.googleapis.com/bucket/image.png",
  "https://storage.googleapis.com:444/bucket/image.png",
  "https://other.supabase.co/storage/v1/object/public/media/screenshot-test.png",
  "http://127.0.0.1/image.png",
  "data:image/png;base64,aGVsbG8=",
])("rejects an untrusted screenshot URL %s before fetching", async (screenshot) => {
  await expect(downloadFirecrawlScreenshot({ screenshot })).rejects.toThrow("invalid screenshot");
  expect(fetchImage).not.toHaveBeenCalled();
});

test("downloads verified provider bytes with redirects disabled and a timeout", async () => {
  expect(await downloadFirecrawlScreenshot({ screenshot: url })).toEqual({
    bytes: png,
    type: "image/png",
    extension: "png",
  });
  expect(fetchImage).toHaveBeenCalledExactlyOnceWith(new URL(url), {
    redirect: "error",
    signal: expect.any(AbortSignal),
  });
});

test("rejects a provider redirect instead of following it", async () => {
  fetchImage.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }),
  );
  await expect(downloadFirecrawlScreenshot({ screenshot: url })).rejects.toThrow("302");
  expect(fetchImage).toHaveBeenCalledTimes(1);
});

test("rejects absent screenshots and error pages returned by the provider", async () => {
  await expect(downloadFirecrawlScreenshot({})).rejects.toThrow("invalid screenshot");
  await expect(
    downloadFirecrawlScreenshot({ screenshot: url, metadata: { statusCode: 404 } }),
  ).rejects.toThrow("invalid screenshot");
  expect(fetchImage).not.toHaveBeenCalled();
});

test("rejects HTML, invalid image bytes, and truncated PNGs", async () => {
  fetchImage.mockResolvedValueOnce(
    new Response("<html></html>", {
      headers: { "content-type": "text/html" },
    }),
  );
  await expect(downloadFirecrawlScreenshot({ screenshot: url })).rejects.toThrow("not a PNG");
  for (const type of ["image/png", "image/jpeg"]) {
    fetchImage.mockResolvedValueOnce(
      new Response("<html></html>", {
        headers: { "content-type": type },
      }),
    );
    await expect(downloadFirecrawlScreenshot({ screenshot: url })).rejects.toThrow("invalid");
  }
  fetchImage.mockResolvedValueOnce(
    new Response(png.subarray(0, -12), {
      headers: { "content-type": "image/png" },
    }),
  );
  await expect(downloadFirecrawlScreenshot({ screenshot: url })).rejects.toThrow("invalid PNG");
});

test("caps response bytes both from Content-Length and while streaming without it", async () => {
  fetchImage.mockResolvedValueOnce(
    new Response(png, {
      headers: {
        "content-type": "image/png",
        "content-length": String(MAX_SITE_PREVIEW_BYTES + 1),
      },
    }),
  );
  await expect(downloadFirecrawlScreenshot({ screenshot: url })).rejects.toThrow("size limit");
  const cancelled = vi.fn();
  let chunks = 0;
  fetchImage.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
          chunks++;
        },
        cancel: cancelled,
      }),
      { headers: { "content-type": "image/png" } },
    ),
  );
  await expect(downloadFirecrawlScreenshot({ screenshot: url })).rejects.toThrow("size limit");
  expect(cancelled).toHaveBeenCalledOnce();
  expect(chunks).toBeLessThanOrEqual(10);
});
