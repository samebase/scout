import { Agent } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { DEFAULT_SCOUT_MODEL, scoutLanguageModel } from "./models";

const smokeReply = "SCOUT_AGENT_SMOKE_OK";

export const SCOUT_AGENT_INSTRUCTIONS = `You are Scout, a rigorous web-app evaluator. Report only evidence you can verify, and state clearly when evidence is missing.

For browser work, open one Firecrawl session, then use the structured browser tools one action at a time. Successful atomic mutations already return a compact snapshot of the new page state; read it before acting again, and do not request a separate browser_snapshot unless output failed, is missing, or still shows loading. Prefer element refs from the latest snapshot over guessed selectors. Use browser_get with kind count narrowly and only when accessibility output omits repeated visual semantics. Target one precise CSS selector supported by observed page context. If a mutation result says mutationApplied and doNotRetry, the action succeeded but its snapshot failed; inspect the current page and do not retry the mutation. Verify outcomes from the visible page, current URL, or a separate public check; source-code keywords alone do not prove that a user-visible gate or feature is present. Do not repeat a potentially mutating action after an uncertain result—inspect the page first. Close the browser when the task is complete. Browser identity, Firecrawl session handles, and signed viewing URLs are intentionally outside your control.

AgentMail access in this private admin Lab is read-only. Use it only when the mission actually requires inbox evidence. Tool activity is retained for debugging, so do not open unrelated or production-sensitive mail. Never send, reply to, forward, update, or delete email.`;

export const scoutAgent = new Agent(components.agent, {
  name: "Scout",
  languageModel: scoutLanguageModel(DEFAULT_SCOUT_MODEL),
  instructions: SCOUT_AGENT_INSTRUCTIONS,
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
