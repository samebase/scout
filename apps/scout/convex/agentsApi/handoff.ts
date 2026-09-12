"use node";

import { v } from "convex/values";
import { outdent } from "outdent";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { getRuntimeEnv } from "../runtimeEnv";
import { createAgentMailInboxClient, requiredAgentMailApiKey } from "../scout/lib/agentMail";
import { humanHandoffOrigin } from "../scout/lib/humanHandoffUrl";

export const notify = internalAction({
  args: { sessionId: v.id("agentsApiSessions"), callId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.runQuery(internal.agentsApi.sessions.handoffNotification, args);
    if (!delivery) return null;
    const url = new URL("/review", humanHandoffOrigin(getRuntimeEnv("SITE_URL")));
    url.searchParams.set("thread", args.sessionId);
    const mail = createAgentMailInboxClient({
      apiKey: requiredAgentMailApiKey(getRuntimeEnv("AGENTMAIL_API_KEY")),
      inboxId: delivery.inboxId,
    });
    await mail.send({
      to: delivery.recipient,
      subject: `${delivery.scoutName} needs your help`,
      text: outdent`
        Open this conversation to take over the browser, then resume ${delivery.scoutName}:

        ${url.href}
      `,
      idempotencyKey: `review-handoff-${args.sessionId}-${args.callId}`,
    });
    return null;
  },
});
