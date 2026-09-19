"use node";

import { ConvexError, v } from "convex/values";
import { SdkError } from "firecrawl";
import outdent from "outdent";
import { z } from "zod";
import { action } from "../functions";
import { internal } from "../_generated/api";
import {
  closeFirecrawlBrowserSession,
  createFirecrawlClient,
  firecrawlBrowserExecutionSucceeded,
} from "./lib/firecrawl";

const browserProfileCounts = z.object({
  cookieCount: z.number().int().nonnegative(),
  cookieDomainCount: z.number().int().nonnegative(),
});

async function profileRequest<T>(operation: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const details =
      error instanceof SdkError
        ? [
            error.status === undefined ? null : `HTTP ${error.status}`,
            error.code ? `code ${error.code}` : null,
          ].filter((detail) => detail !== null)
        : [];
    const message = error instanceof Error ? error.message : String(error);
    const failure = `Firecrawl ${operation}: ${message}${details.length ? ` (${details.join(", ")})` : ""}`;
    console.error(failure);
    throw new ConvexError(failure);
  }
}

export const refresh = action({
  access: "access_scout_manage",
  args: { scoutId: v.id("scouts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout = await ctx.runQuery(internal.scout.scouts.getRuntimeIdentity, args);
    if (!scout) throw new ConvexError("Scout not found");
    const firecrawl = createFirecrawlClient();
    const session = await profileRequest("POST /v2/browser", async () => {
      const created = await firecrawl.browser({
        profile: { name: scout.firecrawl.profileName, saveChanges: false },
        ttl: 120,
        activityTtl: 120,
        streamWebView: false,
      });
      if (!created.id) throw new Error(created.error || "Browser session ID is missing");
      return { ...created, id: created.id };
    });

    const summary = await (async () => {
      try {
        return await profileRequest(`POST /v2/browser/${session.id}/execute`, async () => {
          if (!session.success) throw new Error(session.error || "Could not open browser profile");
          const response = await firecrawl.browserExecute(session.id, {
            language: "node",
            code: outdent`
              JSON.stringify(await page.context().cookies().then(cookies => ({
                cookieCount: cookies.length,
                cookieDomainCount: new Set(cookies.map(cookie => cookie.domain.replace(/^\\./, "").toLowerCase())).size
              })))
            `,
          });
          if (!firecrawlBrowserExecutionSucceeded(response)) {
            throw new Error(
              response.error || response.stderr || "Browser profile inspection failed",
            );
          }
          let counts;
          try {
            counts = browserProfileCounts.parse(JSON.parse(response.result ?? ""));
          } catch {
            throw new Error("Browser profile inspection returned an invalid cookie summary");
          }
          return { ...counts, checkedAt: Date.now() };
        });
      } finally {
        await profileRequest(`DELETE /v2/browser/${session.id}`, async () => {
          const closed = await closeFirecrawlBrowserSession(firecrawl, session.id);
          if (!closed.success) throw new Error(closed.error || "Could not close browser session");
        });
      }
    })();

    await ctx.runMutation(internal.scout.scouts.saveBrowserProfileSummary, {
      scoutId: args.scoutId,
      profileName: scout.firecrawl.profileName,
      summary,
    });
    return null;
  },
});
