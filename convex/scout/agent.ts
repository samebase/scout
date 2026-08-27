import { Agent } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { DEFAULT_SCOUT_MODEL, scoutLanguageModel } from "./models";

const smokeReply = "SCOUT_AGENT_SMOKE_OK";

export const scoutAgent = new Agent(components.agent, {
  name: "Scout",
  languageModel: scoutLanguageModel(DEFAULT_SCOUT_MODEL),
  instructions:
    "You are Scout, a rigorous web-app evaluator. Report only evidence you can verify, and state clearly when evidence is missing.",
});

export const smoke = internalAction({
  args: {},
  returns: v.object({
    threadId: v.string(),
    reply: v.string(),
    replyMatches: v.boolean(),
    savedMessageCount: v.number(),
  }),
  handler: async (ctx) => {
    const { threadId, thread } = await scoutAgent.createThread(ctx, {
      title: "Scout Agent smoke test",
    });
    const result = await thread.generateText({
      prompt: `Reply with exactly ${smokeReply} and no other text.`,
      temperature: 0,
    });
    const reply = result.text.trim();

    return {
      threadId,
      reply,
      replyMatches: reply === smokeReply,
      savedMessageCount: result.savedMessages.length,
    };
  },
});
