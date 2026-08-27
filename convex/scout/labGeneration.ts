import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { scoutAgent } from "./agent";
import { requireOwnedAgentThread } from "./labAccess";

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.string(),
    promptMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnedAgentThread(ctx, args.threadId, args.userId);
    const result = await scoutAgent.streamText(
      ctx,
      { threadId: args.threadId, userId: args.userId },
      { promptMessageId: args.promptMessageId },
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
  },
});
