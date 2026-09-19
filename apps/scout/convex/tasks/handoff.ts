"use node";

import { type Infer, v } from "convex/values";
import { outdent } from "outdent";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { getRuntimeEnv } from "../runtimeEnv";
import { createAgentMailInboxClient, requiredAgentMailApiKey } from "../scout/lib/agentMail";
import { humanHandoffOrigin, humanHandoffUrl } from "../scout/lib/humanHandoffUrl";
import {
  deriveHumanHandoffAccessToken,
  hashHumanHandoffAccessToken,
} from "../scout/lib/humanHandoffAccess";
import { handoffDeadlineMessage } from "../../shared/handoff";
import { publicAction } from "../functions";
import { handoffPage } from "./handoffModel";

export const notify = internalAction({
  args: { sessionId: v.id("agentsApiSessions"), callId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const delivery = await ctx.runQuery(internal.tasks.sessions.handoffNotification, args);
    if (
      !delivery ||
      delivery.expiresAt === null ||
      delivery.expiresAt <= Date.now() ||
      !delivery.providerSessionId
    )
      return null;
    const apiKey = requiredAgentMailApiKey(getRuntimeEnv("AGENTMAIL_API_KEY"));
    const accessToken = deriveHumanHandoffAccessToken(
      {
        ...args,
        turnId: delivery.turnId,
        providerSessionId: delivery.providerSessionId,
        expiresAt: delivery.expiresAt,
      },
      apiKey,
    );
    const tokenHash = hashHumanHandoffAccessToken(accessToken);
    if (!tokenHash) throw new Error("Generated handoff token is invalid");
    const issued = await ctx.runMutation(internal.tasks.handoffRecords.issue, {
      sessionId: args.sessionId,
      access: {
        callId: args.callId,
        turnId: delivery.turnId,
        providerSessionId: delivery.providerSessionId,
        expiresAt: delivery.expiresAt,
        tokenHash,
      },
    });
    if (!issued) return null;
    const url = humanHandoffUrl(
      humanHandoffOrigin(getRuntimeEnv("SITE_URL")),
      args.sessionId,
      accessToken,
    );
    const mail = createAgentMailInboxClient({
      apiKey,
      inboxId: delivery.inboxId,
    });
    await mail.send({
      to: delivery.recipient,
      subject: `${delivery.scoutName} needs your help`,
      text: outdent`
        Open this link to take over the browser, then resume ${delivery.scoutName}. No Scout sign-in is needed.

        ${url}

        This link gives control of Scout's current browser. Keep it private.
        After resuming, close any separate browser tab you opened.

        ${handoffDeadlineMessage(delivery.expiresAt, "UTC")}
      `,
      idempotencyKey: `review-handoff-${args.sessionId}-${args.callId}`,
    });
    return null;
  },
});

const accessArgs = { sessionId: v.string(), accessToken: v.string() };

export const load = publicAction({
  access: "access_public",
  args: accessArgs,
  returns: handoffPage,
  handler: async (ctx, { sessionId, accessToken }): Promise<Infer<typeof handoffPage>> => {
    const tokenHash = hashHumanHandoffAccessToken(accessToken);
    if (!tokenHash) return { status: "invalid" };
    return await ctx.runMutation(internal.tasks.handoffRecords.load, { sessionId, tokenHash });
  },
});

export const resume = publicAction({
  access: "access_public",
  args: accessArgs,
  returns: handoffPage,
  handler: async (ctx, { sessionId, accessToken }): Promise<Infer<typeof handoffPage>> => {
    const tokenHash = hashHumanHandoffAccessToken(accessToken);
    if (!tokenHash) return { status: "invalid" };
    return await ctx.runMutation(internal.tasks.handoffRecords.resume, { sessionId, tokenHash });
  },
});
