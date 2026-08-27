"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { isStepCount, type LanguageModelUsage } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { env, internalAction } from "../_generated/server";
import { scoutAgent } from "./agent";
import { requireOwnedAgentThread } from "./labAccess";
import { scoutLanguageModel, scoutModelValidator, type ScoutTokenUsage } from "./models";

const MAX_GENERATION_STEPS = 24;

function requireSecret(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function tokenUsage(usage: LanguageModelUsage): ScoutTokenUsage {
  return {
    ...(usage.inputTokens === undefined ? {} : { promptTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { completionTokens: usage.outputTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    ...(usage.outputTokenDetails.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: usage.outputTokenDetails.reasoningTokens }),
    ...(usage.inputTokenDetails.cacheReadTokens === undefined
      ? {}
      : { cachedInputTokens: usage.inputTokenDetails.cacheReadTokens }),
  };
}

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.string(),
    promptMessageId: v.string(),
    model: scoutModelValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnedAgentThread(ctx, args.threadId, args.userId);

    let firecrawlClient: MCPClient | undefined;
    let agentMailClient: MCPClient | undefined;

    try {
      firecrawlClient = await createMCPClient({
        transport: {
          type: "http",
          url: "https://mcp.firecrawl.dev/v2/mcp",
          headers: {
            Authorization: `Bearer ${requireSecret(env.FIRECRAWL_API_KEY, "FIRECRAWL_API_KEY")}`,
          },
        },
      });
      agentMailClient = await createMCPClient({
        transport: {
          type: "http",
          url: "https://mcp.agentmail.to/mcp",
          headers: {
            "x-api-key": requireSecret(env.AGENTMAIL_API_KEY, "AGENTMAIL_API_KEY"),
          },
        },
      });

      const tools = {
        ...(await firecrawlClient.tools()),
        ...(await agentMailClient.tools()),
      };
      const result = await scoutAgent.streamText(
        ctx,
        { threadId: args.threadId, userId: args.userId },
        {
          promptMessageId: args.promptMessageId,
          model: scoutLanguageModel(args.model),
          tools,
          stopWhen: isStepCount(MAX_GENERATION_STEPS),
        },
        {
          saveStreamDeltas: {
            returnImmediately: true,
            chunking: "word",
            throttleMs: 100,
          },
        },
      );
      await result.consumeStream();
      await ctx.runMutation(internal.scout.lab.completeGeneration, {
        promptMessageId: args.promptMessageId,
        usage: tokenUsage(await result.totalUsage),
      });
      return null;
    } finally {
      const closePromises: Promise<void>[] = [];
      if (firecrawlClient) closePromises.push(firecrawlClient.close());
      if (agentMailClient) closePromises.push(agentMailClient.close());
      await Promise.allSettled(closePromises);
    }
  },
});
