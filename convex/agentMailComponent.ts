import { AgentMail } from "@agentmail/convex";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { env, internalAction } from "./_generated/server";

export const agentMail = new AgentMail(components.agentmail);

export const verifyConnection = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!env.AGENTMAIL_API_KEY) {
      throw new Error("AGENTMAIL_API_KEY is missing from the Scout deployment.");
    }
    await agentMail.listInboxes(ctx, { limit: 1 });
    return null;
  },
});
