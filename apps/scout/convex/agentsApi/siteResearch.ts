"use node";

import { v } from "convex/values";
import { SdkError } from "firecrawl";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { action } from "../functions";
import { siteHostnameSchema } from "../../shared/site";
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
    try {
      const client = createFirecrawlClient();
      const status = await client.getAgentStatus(research.jobId);
      if (status.status === "processing") {
        if (!(await client.cancelAgent(research.jobId)))
          throw new Error(`Could not cancel Firecrawl research job ${research.jobId}`);
        credits = null;
      } else credits = status.creditsUsed ?? null;
    } catch (error) {
      credits = null;
      state = {
        kind: "failed",
        finishedAt: Date.now(),
        error: `${state.kind === "failed" ? `${state.error} ` : ""}Firecrawl cleanup failed: ${diagnosticMessage(error)}`,
      };
    }
  }
  await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
    researchId: research._id,
    jobId: research.jobId,
    state,
    responsePath: research.responsePath,
    credits,
    profile: null,
  });
}

export const refresh = action({
  access: "access_lab",
  args: { site: v.string() },
  returns: v.id("agentsApiSiteResearch"),
  handler: async (ctx, args): Promise<Doc<"agentsApiSiteResearch">["_id"]> => {
    const site = siteHostnameSchema.parse(args.site);
    if (researchSite(`https://${site}/`) !== site)
      throw new Error("Research requires a public hostname");
    const current = await ctx.runQuery(internal.agentsApi.siteResearchRecords.currentSiteJob, {
      site,
    });
    if (current?.state.kind === "running") return current._id;
    if (current?.state.kind === "failed" && current.jobId) {
      const client = createFirecrawlClient();
      try {
        const status = await client.getAgentStatus(current.jobId);
        if (status.status === "processing" && !(await client.cancelAgent(current.jobId)))
          throw new Error(
            "Could not stop the previous Firecrawl research job. Retry after resolving it.",
          );
      } catch (error) {
        if (!(error instanceof SdkError) || (error.status !== 404 && error.status !== 410))
          throw error;
      }
    }
    return ctx.runMutation(internal.agentsApi.siteResearchRecords.refresh, {
      site,
      userId: ctx.viewer.userId,
      expectedResearchId: current?._id ?? null,
    });
  },
});

export const run = internalAction({
  args: { sessionId: v.id("agentsApiSessions"), prompt: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const researchId = await ctx.runMutation(internal.agentsApi.siteResearchRecords.start, {
      sessionId: args.sessionId,
      site: researchSite(args.prompt),
    });
    if (!researchId) return false;
    return advanceTask(ctx, args.sessionId);
  },
});

async function advanceTask(
  ctx: ActionCtx,
  sessionId: Doc<"agentsApiSessions">["_id"],
): Promise<boolean> {
  const research = await ctx.runQuery(internal.agentsApi.siteResearchRecords.get, { sessionId });
  if (!research || research.state.kind !== "waiting") return false;
  const { session } = await ctx.runQuery(internal.agentsApi.sessions.runtime, { sessionId });
  if (session.state.kind !== "starting" || !session.active) {
    await endResearch(ctx, research, { kind: "cancelled", finishedAt: Date.now() });
    return false;
  }
  const source = await ctx.runQuery(internal.agentsApi.siteResearchRecords.job, {
    researchId: research.state.researchId,
  });
  if (!source || source.sessionId !== null) throw new Error("Shared site research not found");
  switch (source.state.kind) {
    case "running":
      return true;
    case "waiting":
      throw new Error("Site research cannot wait on a task");
    case "completed": {
      try {
        const briefPath = "/workspace/research/brief.md";
        await saveWorkspaceFile(ctx, {
          path: briefPath,
          text: source.state.brief,
          userId: session.userId,
          target: { kind: "agent_session", sessionId },
        });
        await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
          researchId: research._id,
          jobId: research.jobId,
          responsePath: null,
          profile: null,
          credits: research.state.reused ? 0 : source.credits,
          state: {
            kind: "completed",
            finishedAt: Date.now(),
            brief: source.state.brief,
            briefPath,
            source: {
              researchId: source._id,
              researchedAt: source.state.finishedAt,
              reused: research.state.reused,
            },
          },
        });
      } catch (error) {
        await endResearch(ctx, research, {
          kind: "failed",
          finishedAt: Date.now(),
          error: diagnosticMessage(error),
        });
      }
      return false;
    }
    case "failed":
    case "cancelled":
    case "skipped":
      await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
        researchId: research._id,
        jobId: research.jobId,
        state: source.state,
        responsePath: null,
        profile: null,
        credits: research.state.reused ? 0 : source.credits,
      });
      return false;
  }
}

export const advance = internalAction({
  args: { sessionId: v.id("agentsApiSessions") },
  returns: v.boolean(),
  handler: (ctx, args): Promise<boolean> => advanceTask(ctx, args.sessionId),
});

// The shared job outlives an individual task. Its bounded poll uses the existing research record.
export const process = internalAction({
  args: { researchId: v.id("agentsApiSiteResearch") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const research = await ctx.runQuery(internal.agentsApi.siteResearchRecords.job, args);
    if (!research || research.state.kind !== "running") return null;
    if (research.sessionId !== null || !research.site)
      throw new Error("Expected site-owned research");
    const target = { kind: "site" as const, site: research.site };
    let responsePath = research.responsePath;
    let jobId = research.jobId;
    try {
      if (Date.now() - research._creationTime >= SITE_RESEARCH_TIMEOUT_MS)
        throw new Error(`Site research exceeded ${SITE_RESEARCH_TIMEOUT_MS / 1000} seconds`);
      if (!jobId) {
        const request = researchRequest(research.site);
        const requestPath = "/workspace/research/request.json";
        await saveWorkspaceFile(ctx, {
          target,
          userId: research.userId,
          path: requestPath,
          text: JSON.stringify(request, null, 2),
        });
        const job = await createFirecrawlClient().startAgent(request);
        if (!job.success || !job.id)
          throw new Error(job.error ?? "Firecrawl returned no research job");
        jobId = job.id;
        if (
          !(await ctx.runMutation(internal.agentsApi.siteResearchRecords.submitted, {
            researchId: research._id,
            jobId,
            requestPath,
          }))
        )
          throw new Error("Site research stopped during submission");
      } else {
        const response = await createFirecrawlClient().getAgentStatus(jobId);
        if (!response.success)
          throw new Error(response.error ?? "Firecrawl research request failed");
        if (response.status !== "processing") {
          responsePath = "/workspace/research/result.json";
          await saveWorkspaceFile(ctx, {
            target,
            userId: research.userId,
            path: responsePath,
            text: JSON.stringify(response, null, 2),
          });
          if (response.status === "failed") {
            await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
              researchId: research._id,
              jobId,
              responsePath,
              credits: response.creditsUsed ?? null,
              profile: null,
              state: {
                kind: "failed",
                finishedAt: Date.now(),
                error: diagnosticMessage(new Error(response.error ?? "Firecrawl research failed")),
              },
            });
            return null;
          }
          const result = siteBrief.parse(response.data);
          const finishedAt = Date.now();
          const markdown = renderBrief(research.site, result, finishedAt);
          const briefPath = "/workspace/research/brief.md";
          await saveWorkspaceFile(ctx, {
            target,
            userId: research.userId,
            path: briefPath,
            text: markdown,
          });
          await ctx.runMutation(internal.agentsApi.siteResearchRecords.finish, {
            researchId: research._id,
            jobId,
            responsePath,
            credits: response.creditsUsed ?? null,
            profile: {
              name: result.name,
              homepageUrl: `https://${research.site}/`,
              overview: result.overview,
              brief: markdown,
              researchedAt: finishedAt,
            },
            state: { kind: "completed", finishedAt, brief: markdown, briefPath },
          });
          return null;
        }
      }
      await ctx.scheduler.runAfter(5_000, internal.agentsApi.siteResearch.process, args);
    } catch (error) {
      await endResearch(
        ctx,
        { ...research, jobId, responsePath },
        {
          kind: "failed",
          finishedAt: Date.now(),
          error: diagnosticMessage(error),
        },
      );
    }
    return null;
  },
});
