"use node";

import { v } from "convex/values";
import { publicAction } from "../functions";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { workspaceStorage } from "../workspaceStorage";
import { getRuntimeEnv } from "../runtimeEnv";
import { diagnosticMessage } from "../scout/lib/redaction";
import type { BrowserScreenshot } from "../scout/playwrightBrowser";
import { MAX_SCREENSHOT_BYTES } from "./screenshotModel";

export async function saveScreenshot(
  ctx: ActionCtx,
  args: {
    sessionId: Id<"agentsApiSessions">;
    providerSessionId: string;
    toolCallId: string;
    note: string;
    take: () => Promise<BrowserScreenshot>;
  },
) {
  const captureId = await ctx.runMutation(internal.agentsApi.screenshotRecords.prepare, {
    sessionId: args.sessionId,
    providerSessionId: args.providerSessionId,
    toolCallId: args.toolCallId,
    note: args.note,
  });
  let uploadedKey: string | null = null;
  try {
    const capture = await args.take();
    if (capture.bytes.length > MAX_SCREENSHOT_BYTES)
      throw new Error("Screenshot exceeds the image size limit");
    const deploymentUrl = getRuntimeEnv("CONVEX_CLOUD_URL");
    if (!deploymentUrl) throw new Error("Deployment URL is not configured");
    const key = `deployments/${encodeURIComponent(new URL(deploymentUrl).host)}/tasks/${args.sessionId}/screenshots/${captureId}.png`;
    const storage = workspaceStorage();
    uploadedKey = key;
    await storage.store(ctx, capture.bytes, { key, type: "image/png", disposition: "inline" });
    await ctx.runMutation(internal.agentsApi.screenshotRecords.finish, {
      screenshotId: captureId,
      key,
      metadata: capture.metadata,
    });
    return { kind: "ready" as const, captureId, note: args.note, metadata: capture.metadata };
  } catch (error) {
    let message = diagnosticMessage(error);
    if (uploadedKey) {
      try {
        await workspaceStorage().deleteObject(ctx, uploadedKey);
      } catch (cleanupError) {
        message += ` Image cleanup also failed: ${diagnosticMessage(cleanupError)}`;
      }
    }
    await ctx.runMutation(internal.agentsApi.screenshotRecords.fail, {
      screenshotId: captureId,
      message,
    });
    return { kind: "failed" as const, message };
  }
}

export const imageUrl = publicAction({
  access: "access_public",
  args: { screenshotId: v.id("agentsApiScreenshots") },
  returns: v.union(v.object({ url: v.string(), expiresAtMs: v.number() }), v.null()),
  handler: async (ctx, args) => {
    const key = await ctx.runQuery(internal.agentsApi.screenshotRecords.imageKey, args);
    if (!key) return null;
    const expiresIn = 900;
    const url = await workspaceStorage().getUrl(key, { expiresIn });
    return { url, expiresAtMs: Date.now() + expiresIn * 1000 };
  },
});
