import { v } from "convex/values";
import { env, internalMutation } from "./_generated/server";
import { readDevSeedPasswordAccountConfig } from "./devAuthConfig";
import { syncChatSite } from "./scout/siteListings";

export const seed = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (env.SSR_FIXTURE_DEPLOYMENT_URL !== env.CONVEX_CLOUD_URL)
      throw new Error("Explicitly enable SSR fixtures for this deployment URL");
    const config = readDevSeedPasswordAccountConfig();
    if (config.kind === "disabled") throw new Error("Development seeding is disabled");
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", config.email))
      .unique();
    if (!user || user.state === "deleted" || user.state === "deleting" || !user.isApproved)
      throw new Error("Seed the approved development account first");
    const existing = await ctx.db
      .query("scouts")
      .withIndex("by_slug", (q) => q.eq("slug", "ssr-preview"))
      .unique();
    if (existing) return null;
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "SSR Preview",
      slug: "ssr-preview",
      status: "disabled",
      websiteIdentity: { firstName: "SSR", lastName: "Preview" },
      agentMail: { inboxId: "ssr-preview", address: "ssr-preview@example.invalid" },
      firecrawl: { profileName: "ssr-preview" },
    });
    const createdAt = Date.now();
    for (let index = 1; index <= 8; index++) {
      for (const visibility of ["public", "private"] as const) {
        const title = `SSR preview ${index}: ${visibility} review`;
        const sessionId = await ctx.db.insert("agentsApiSessions", {
          userId: user._id,
          scoutId,
          scoutName: "SSR Preview",
          title,
          model: "gpt-5.6-luna",
          state: { kind: "idle" },
          active: false,
          nextSequence: 0,
          browser: null,
          usage: null,
          walkthrough: {
            summary:
              "Synthetic review for checking Scout server rendering. No browser or model was run.",
            sections: [],
          },
        });
        await ctx.db.insert("agentsApiRequestChecks", {
          sessionId,
          kind: "initial",
          model: "gpt-5.6-luna",
          prompt: "SSR preview fixture",
          state: {
            kind: "completed",
            finishedAt: createdAt,
            call: { startedAt: createdAt, request: "{}", response: "{}", usage: null },
            result: { kind: "initial", title, decision: { kind: "approved" } },
          },
        });
        const chatId = await ctx.db.insert("scoutChats", {
          userId: user._id,
          scoutId,
          threadId: sessionId,
          createdAt: createdAt + index,
          purpose: { kind: "review" },
          visibility,
          primarySite: `ssr-${index}.example`,
          runtime: { kind: "agents_api", sessionId },
          publicSiteEligible: false,
        });
        const chat = await ctx.db.get(chatId);
        if (!chat) throw new Error("SSR fixture chat was not inserted");
        await syncChatSite(ctx, chat);
      }
    }
    return null;
  },
});
