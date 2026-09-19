"use node";

import { R2 } from "@convex-dev/r2";
import { v } from "convex/values";
import { z } from "zod";
import { components, internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import { getRuntimeEnv } from "../runtimeEnv";
import { workspaceStorage } from "../workspaceStorage";
import { diagnosticMessage } from "./lib/redaction";
import { previewPublicationArgs, publicPreviewKey, publicPreviewUrl } from "./sitePreviewModel";

function publicStorage() {
  const bucket = getRuntimeEnv("PUBLIC_MEDIA_BUCKET");
  const endpoint = getRuntimeEnv("R2_ENDPOINT");
  const accessKeyId = getRuntimeEnv("PUBLIC_MEDIA_ACCESS_KEY_ID");
  const secretAccessKey = getRuntimeEnv("PUBLIC_MEDIA_SECRET_ACCESS_KEY");
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey)
    throw new Error(
      "Public preview storage requires PUBLIC_MEDIA_BUCKET, R2_ENDPOINT, PUBLIC_MEDIA_ACCESS_KEY_ID, and PUBLIC_MEDIA_SECRET_ACCESS_KEY",
    );
  return new R2(components.r2, { bucket, endpoint, accessKeyId, secretAccessKey });
}

const purgeResponse = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })),
});

const storageFailure = z.object({
  name: z.string(),
  message: z.string(),
  $metadata: z.object({ httpStatusCode: z.number().optional(), requestId: z.string().optional() }),
});

function storageError(method: "PUT" | "DELETE", key: string, error: unknown) {
  const parsed = storageFailure.safeParse(error);
  const details = parsed.success
    ? `${parsed.data.name}: ${parsed.data.message}; HTTP ${parsed.data.$metadata.httpStatusCode ?? "not provided"}; request ${parsed.data.$metadata.requestId ?? "not provided"}`
    : diagnosticMessage(error);
  return new Error(`R2 ${method} ${key} failed (${details})`, { cause: error });
}

async function removePublicPreview(ctx: ActionCtx, key: string) {
  const zone = getRuntimeEnv("PUBLIC_MEDIA_ZONE_ID");
  const token = getRuntimeEnv("PUBLIC_MEDIA_CACHE_PURGE_TOKEN");
  if (!zone || !token)
    throw new Error(
      "Public preview removal requires PUBLIC_MEDIA_ZONE_ID and PUBLIC_MEDIA_CACHE_PURGE_TOKEN",
    );
  const url = publicPreviewUrl(key);
  await publicStorage()
    .deleteObject(ctx, key)
    .catch((error: unknown) => {
      throw storageError("DELETE", key, error);
    });
  const path = `/zones/${encodeURIComponent(zone)}/purge_cache`;
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ files: [url] }),
    signal: AbortSignal.timeout(15_000),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `Cloudflare POST ${path} failed (HTTP ${response.status}; invalid JSON; request ${response.headers.get("cf-ray") ?? "not provided"})`,
    );
  }
  const result = purgeResponse.safeParse(body);
  if (!result.success || !response.ok || !result.data.success) {
    const details = result.success
      ? result.data.errors.map(({ code, message }) => `${code}: ${message}`).join("; ")
      : "Invalid response";
    throw new Error(
      `Cloudflare POST ${path} failed (HTTP ${response.status}; ${details}; request ${response.headers.get("cf-ray") ?? "not provided"})`,
    );
  }
}

export const remove = internalAction({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    await removePublicPreview(ctx, key);
    return null;
  },
});

export const publish = internalAction({
  args: previewPublicationArgs.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await ctx.runQuery(internal.scout.sitePreviewRecords.publicationCurrent, args)))
      return null;
    const key = publicPreviewKey(args.sourceKey, args.version);
    let uploadStarted = false;
    let accepted = false;
    try {
      // Check removal configuration before making any image public.
      if (
        !getRuntimeEnv("PUBLIC_MEDIA_ZONE_ID") ||
        !getRuntimeEnv("PUBLIC_MEDIA_CACHE_PURGE_TOKEN")
      )
        throw new Error(
          "Public preview publishing requires PUBLIC_MEDIA_ZONE_ID and PUBLIC_MEDIA_CACHE_PURGE_TOKEN",
        );
      publicPreviewUrl(key);
      const storage = publicStorage();
      const source = await workspaceStorage().getUrl(args.sourceKey);
      const response = await fetch(source, {
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (!response.ok)
        throw new Error(
          `R2 GET ${args.sourceKey} failed (HTTP ${response.status}; request ${response.headers.get("x-amz-request-id") ?? response.headers.get("cf-ray") ?? "not provided"})`,
        );
      const image = await response.blob();
      if (image.type !== "image/png" && image.type !== "image/jpeg")
        throw new Error("Stored preview is not a PNG or JPEG");
      uploadStarted = true;
      await storage
        .store(ctx, image, {
          key,
          type: image.type,
          disposition: "inline",
          cacheControl: "public, max-age=60, s-maxage=31536000, must-revalidate",
        })
        .catch((error: unknown) => {
          throw storageError("PUT", key, error);
        });
      accepted = await ctx.runMutation(internal.scout.sitePreviewRecords.finishPublication, {
        ...args,
        result: { kind: "public" },
      });
    } catch (error) {
      let message = diagnosticMessage(error);
      if (uploadStarted) {
        try {
          await removePublicPreview(ctx, key);
        } catch (cleanupError) {
          message += ` Public image cleanup failed: ${diagnosticMessage(cleanupError)}`;
        }
      }
      await ctx.runMutation(internal.scout.sitePreviewRecords.finishPublication, {
        ...args,
        result: { kind: "failed", message },
      });
      // Keep the failure visible in Convex logs as well as the site's publication state.
      throw new Error(message);
    }
    if (!accepted) await removePublicPreview(ctx, key);
    return null;
  },
});
