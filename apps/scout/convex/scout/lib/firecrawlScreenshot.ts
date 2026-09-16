"use node";

import { z } from "zod";

export const MAX_SITE_PREVIEW_BYTES = 8 * 1024 * 1024;

const screenshotResponse = z.object({
  screenshot: z
    .string()
    .max(8192)
    .transform((value, ctx) => {
      const url = URL.parse(value);
      // Firecrawl's hosted screenshots use GCS; its docs also show this exact Supabase project.
      // https://github.com/firecrawl/firecrawl/blob/main/apps/api/src/services/index-screenshot-url.ts
      // https://docs.firecrawl.dev/features/scrape#interacting-with-the-page-with-actions
      if (
        !url ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        !(
          (url.hostname === "storage.googleapis.com" &&
            /^\/[^/]+\/.+\.(png|jpe?g)$/.test(url.pathname)) ||
          (url.hostname === "alttmdsdujxrfnakrkyi.supabase.co" &&
            /^\/storage\/v1\/object\/public\/media\/screenshot-[\w-]+\.(png|jpe?g)$/.test(
              url.pathname,
            ))
        )
      ) {
        ctx.addIssue({ code: "custom", message: "Firecrawl returned an untrusted screenshot URL" });
        return z.NEVER;
      }
      return url;
    }),
  metadata: z.object({ statusCode: z.number().int().min(200).max(399).optional() }).optional(),
});

export async function downloadFirecrawlScreenshot(value: unknown) {
  const parsed = screenshotResponse.safeParse(value);
  if (!parsed.success) throw new Error("Firecrawl returned an invalid screenshot response or URL");
  const response = await fetch(parsed.data.screenshot, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Screenshot download failed (${response.status})`);
  const type = response.headers.get("content-type")?.split(";")[0].trim();
  if (type !== "image/png" && type !== "image/jpeg") {
    await response.body?.cancel();
    throw new Error("Screenshot download is not a PNG or JPEG");
  }
  if (Number(response.headers.get("content-length")) > MAX_SITE_PREVIEW_BYTES) {
    await response.body?.cancel();
    throw new Error("Screenshot exceeds the image size limit");
  }
  if (!response.body) throw new Error("Screenshot download has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_SITE_PREVIEW_BYTES) {
        await reader.cancel();
        throw new Error("Screenshot exceeds the image size limit");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, length);
  if (type === "image/png") {
    if (
      bytes.length < 45 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      bytes.readUInt32BE(16) === 0 ||
      bytes.readUInt32BE(20) === 0 ||
      bytes.readUInt32BE(16) > 4096 ||
      bytes.readUInt32BE(20) > 4096 ||
      bytes.subarray(-12).toString("hex") !== "0000000049454e44ae426082"
    )
      throw new Error("Screenshot contains invalid PNG bytes");
    return { bytes, type, extension: "png" };
  }
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    throw new Error("Screenshot contains invalid JPEG bytes");
  return { bytes, type, extension: "jpg" };
}
