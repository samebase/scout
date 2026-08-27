"use node";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { isStepCount } from "ai";
import { v } from "convex/values";
import { env, internalAction } from "../_generated/server";
import { scoutAgent } from "./agent";
import { requireOwnedAgentThread } from "./labAccess";

function requireSecret(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.string(),
    promptMessageId: v.string(),
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
          tools,
          stopWhen: isStepCount(12),
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
      return null;
    } finally {
      const closePromises: Promise<void>[] = [];
      if (firecrawlClient) closePromises.push(firecrawlClient.close());
      if (agentMailClient) closePromises.push(agentMailClient.close());
      await Promise.allSettled(closePromises);
    }
  },
});
