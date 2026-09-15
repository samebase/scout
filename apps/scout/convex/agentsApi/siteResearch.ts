"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { saveWorkspaceFile } from "../scout/workspaceTools";
import { createFirecrawlClient } from "../scout/lib/firecrawl";
import { diagnosticMessage } from "../scout/lib/redaction";
import { researchFinishedState, SITE_RESEARCH_TIMEOUT_MS } from "./siteResearchModel";
import { researchSite, researchRequest, siteBrief, renderBrief } from "./siteResearchSources";

export async function endResearch(
  ctx: ActionCtx,
  research: Doc<"agentsApiSiteResearch">,
  state: typeof researchFinishedState.type,
) {
  let credits = research.credits;
  if (research.jobId) {
    const client = createFirecrawlClient();
    const status = await client.getAgentStatus(research.jobId);
    if (status.status === "processing") {
      if (!(await client.cancelAgent(research.jobId)))
        throw new Error(`Could not cancel Firecrawl research job ${research.jobId}`);
      // In-flight work can still accrue credits after cancellation is accepted.
      credits = null;
    } else {
      credits = status.creditsUsed ?? null;
    }
  }
  await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
    researchId: research._id,
    state,
    responsePath: research.responsePath,
    credits,
  });
}

export const run = internalAction({
  args: { sessionId: v.id("agentsApiSessions"), prompt: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const site = researchSite(args.prompt);
    const researchId = await ctx.runMutation(internal.agentsApi.siteResearchRecords.start, {
      sessionId: args.sessionId,
      site,
    });
    if (!researchId) return false;
    if (!site) {
      await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
        researchId,
        responsePath: null,
        credits: 0,
        state: {
          kind: "skipped",
          finishedAt: Date.now(),
          reason: "No single public HTTPS site in the request.",
        },
      });
      return false;
    }
    const { session } = await ctx.runQuery(internal.agentsApi.sessions.runtime, {
      sessionId: args.sessionId,
    });
    let jobId: string | null = null;
    try {
      const request = researchRequest(site);
      const requestPath = "/workspace/research/request.json";
      await saveWorkspaceFile(ctx, {
        path: requestPath,
        text: JSON.stringify(request, null, 2),
        userId: session.userId,
        target: { kind: "agent_session", sessionId: session._id },
      });
      const current = await ctx.runQuery(internal.agentsApi.sessions.runtime, {
        sessionId: args.sessionId,
      });
      if (current.session.state.kind !== "starting" || !current.session.active)
        throw new Error("Site research cancelled before submission");
      const job = await createFirecrawlClient().startAgent(request);
      if (!job.success || !job.id)
        throw new Error(job.error ?? "Firecrawl returned no research job");
      jobId = job.id;
      if (
        !(await ctx.runMutation(internal.agentsApi.siteResearchRecords.submitted, {
          researchId,
          jobId,
          requestPath,
        }))
      )
        throw new Error("Site research cancelled during submission");
      return true;
    } catch (error) {
      if (jobId && !(await createFirecrawlClient().cancelAgent(jobId)))
        throw new Error(`Could not cancel Firecrawl research job ${jobId}`);
      await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
        researchId,
        responsePath: null,
        credits: null,
        state: { kind: "failed", finishedAt: Date.now(), error: diagnosticMessage(error) },
      });
      return false;
    }
  },
});

export const advance = internalAction({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const research = await ctx.runQuery(internal.agentsApi.siteResearchRecords.get, args);
    if (!research || research.state.kind !== "running") return false;
    const { session } = await ctx.runQuery(internal.agentsApi.sessions.runtime, args);
    if (session.state.kind !== "starting" || !session.active) {
      await endResearch(ctx, research, { kind: "cancelled", finishedAt: Date.now() });
      return false;
    }
    let responsePath: string | null = null;
    try {
      if (!research.jobId || !research.site) throw new Error("Research job was not submitted");
      if (Date.now() - research._creationTime >= SITE_RESEARCH_TIMEOUT_MS)
        throw new Error(`Site research exceeded ${SITE_RESEARCH_TIMEOUT_MS / 1000} seconds`);
      const response = await createFirecrawlClient().getAgentStatus(research.jobId);
      if (!response.success) throw new Error(response.error ?? "Firecrawl research request failed");
      if (response.status === "processing") return true;
      await saveWorkspaceFile(ctx, {
        path: "/workspace/research/result.json",
        text: JSON.stringify(response, null, 2),
        userId: session.userId,
        target: { kind: "agent_session", sessionId: session._id },
      });
      responsePath = "/workspace/research/result.json";
      if (response.status === "failed") {
        await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
          researchId: research._id,
          responsePath,
          credits: response.creditsUsed ?? null,
          state: {
            kind: "failed",
            finishedAt: Date.now(),
            error: response.error ?? "Firecrawl research failed",
          },
        });
        return false;
      }
      const markdown = renderBrief(research.site, siteBrief.parse(response.data));
      const briefPath = "/workspace/research/brief.md";
      await saveWorkspaceFile(ctx, {
        path: briefPath,
        text: markdown,
        userId: session.userId,
        target: { kind: "agent_session", sessionId: session._id },
      });
      // Each chat keeps its own brief; the site workspace holds the latest public research.
      await saveWorkspaceFile(ctx, {
        path: briefPath,
        text: markdown,
        userId: session.userId,
        target: { kind: "site", site: research.site },
      });
      await ctx.runMutation(internal.scout.reviewSites.identify, {
        sessionId: session._id,
        site: research.site,
      });
      await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
        researchId: research._id,
        responsePath,
        credits: response.creditsUsed ?? null,
        state: { kind: "completed", finishedAt: Date.now(), brief: markdown, briefPath },
      });
    } catch (error) {
      await endResearch(
        ctx,
        { ...research, responsePath },
        {
          kind: "failed",
          finishedAt: Date.now(),
          error: diagnosticMessage(error),
        },
      );
    }
    return false;
  },
});
