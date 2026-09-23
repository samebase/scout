"use node";

import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import { action, publicAction } from "../functions";
import { getRuntimeEnv } from "../runtimeEnv";
import { workspaceStorage } from "../workspaceStorage";
import { siteHostnameSchema } from "../../shared/site";
import { publicResearchHostnameSchema } from "../tasks/siteResearchSources";
import { createFirecrawlClient } from "./lib/firecrawl";
import { downloadFirecrawlScreenshot } from "./lib/firecrawlScreenshot";
import { diagnosticMessage } from "./lib/redaction";

async function capturePreview(ctx: ActionCtx, input: string, retryFailed: boolean): Promise<null> {
  const site = publicResearchHostnameSchema.parse(input);
  const siteId = await ctx.runMutation(internal.scout.sitePreviewRecords.claim, {
    site,
    retryFailed,
  });
  if (!siteId) return null;
  let uploadedKey: string | null = null;
  try {
    const deploymentUrl = getRuntimeEnv("CONVEX_CLOUD_URL");
    if (!deploymentUrl) throw new Error("Deployment URL is not configured");
    const storage = workspaceStorage();
    const response = await createFirecrawlClient().scrape(`https://${site}/`, {
      formats: [{ type: "screenshot", fullPage: false, viewport: { width: 1440, height: 900 } }],
      maxAge: 0,
      timeout: 45_000,
      autoResume: false,
      proxy: "basic",
    });
    const capturedAt = Date.now();
    const image = await downloadFirecrawlScreenshot(response);
    const key = `deployments/${encodeURIComponent(new URL(deploymentUrl).host)}/sites/${encodeURIComponent(site)}/previews/${randomUUID()}.${image.extension}`;
    uploadedKey = key;
    await storage.store(ctx, image.bytes, { key, type: image.type, disposition: "inline" });
    await ctx.runMutation(internal.scout.sitePreviewRecords.finish, {
      siteId,
      preview: { kind: "ready", capturedAt, key },
    });
  } catch (error) {
    let message = diagnosticMessage(error);
    if (uploadedKey) {
      try {
        await workspaceStorage().deleteObject(ctx, uploadedKey);
      } catch (cleanupError) {
        message += ` Image cleanup also failed: ${diagnosticMessage(cleanupError)}`;
      }
    }
    await ctx.runMutation(internal.scout.sitePreviewRecords.finish, {
      siteId,
      preview: { kind: "failed", failedAt: Date.now(), message },
    });
  }
  return null;
}

export const ensure = internalAction({
  args: { site: v.string() },
  returns: v.null(),
  handler: (ctx, { site }): Promise<null> => capturePreview(ctx, site, false),
});

export const capture = action({
  access: "access_lab",
  args: { site: v.string() },
  returns: v.null(),
  handler: async (ctx, { site }): Promise<null> => {
    const hostname = siteHostnameSchema.parse(site);
    if (
      await ctx.runMutation(internal.scout.sitePreviewRecords.retryPublication, { site: hostname })
    )
      return null;
    return capturePreview(ctx, hostname, true);
  },
});

export const imageUrl = publicAction({
  access: "access_public",
  args: { site: v.string() },
  returns: v.union(v.object({ url: v.string(), expiresAtMs: v.number() }), v.null()),
  handler: async (ctx, args) => {
    const key = await ctx.runQuery(internal.scout.sitePreviewRecords.imageKey, args);
    if (!key) return null;
    const expiresIn = 900;
    const url = await workspaceStorage().getUrl(key, { expiresIn });
    return { url, expiresAtMs: Date.now() + expiresIn * 1000 };
  },
});
