"use node";

import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { getRuntimeEnv } from "./runtimeEnv";
import { humanHandoffDeliveryArgsValidator } from "./humanHandoffDeliveryModel";
import { humanHandoffEmail } from "./scout/humanHandoffTool";
import {
  agentMailFailureIsAmbiguous,
  createAgentMailInboxClient,
  requiredAgentMailApiKey,
  type AgentMailInboxClient,
} from "./scout/lib/agentMail";
import {
  deriveHumanHandoffAccessToken,
  hashHumanHandoffAccessToken,
  humanHandoffOrigin,
  humanHandoffUrl,
} from "./scout/lib/humanHandoffAccess";

const EMAIL_DELIVERY_TIMEOUT_MS = 15_000;

const deliveryResultValidator = v.union(
  v.object({ kind: v.literal("sent") }),
  v.object({ kind: v.literal("skipped") }),
  v.object({ kind: v.literal("definitive_failure") }),
);

type DeliveryResult = Infer<typeof deliveryResultValidator>;

type HumanHandoffDeliveryDependencies = {
  prepare: () => Promise<{ kind: "ready"; claimExpiresAt: number } | { kind: "skipped" }>;
  sendEmail: AgentMailInboxClient["send"];
  now?: () => number;
  timeoutSignal?: (milliseconds: number) => AbortSignal;
};

type DeliverableHumanHandoff = {
  handoffId: string;
  inboxId: string;
  recipientEmail: string;
  scoutName: string;
  handoffUrl: string;
};

export async function runHumanHandoffDelivery(
  delivery: DeliverableHumanHandoff,
  dependencies: HumanHandoffDeliveryDependencies,
): Promise<DeliveryResult> {
  const prepared = await dependencies.prepare();
  if (prepared.kind === "skipped") return prepared;
  const remainingMs = prepared.claimExpiresAt - (dependencies.now ?? Date.now)();
  if (remainingMs <= 0) return { kind: "skipped" };
  const timeoutSignal =
    dependencies.timeoutSignal ?? ((milliseconds: number) => AbortSignal.timeout(milliseconds));
  try {
    await dependencies.sendEmail(
      humanHandoffEmail({
        handoffId: delivery.handoffId,
        recipientEmail: delivery.recipientEmail,
        scoutName: delivery.scoutName,
        handoffUrl: delivery.handoffUrl,
        claimExpiresAt: prepared.claimExpiresAt,
      }),
      { signal: timeoutSignal(Math.min(EMAIL_DELIVERY_TIMEOUT_MS, remainingMs)) },
    );
    return { kind: "sent" };
  } catch (error) {
    if (agentMailFailureIsAmbiguous(error)) throw error;
    return { kind: "definitive_failure" };
  }
}

export const send = internalAction({
  args: humanHandoffDeliveryArgsValidator.fields,
  returns: deliveryResultValidator,
  handler: async (ctx, args): Promise<DeliveryResult> => {
    const prepared = await ctx.runQuery(internal.humanHandoffs.prepareDelivery, {
      handoffId: args.handoffId,
    });
    if (prepared.kind !== "ready") return prepared;
    let apiKey: string;
    let handoffUrl: string;
    try {
      apiKey = requiredAgentMailApiKey(getRuntimeEnv("AGENTMAIL_API_KEY"));
      const accessToken = deriveHumanHandoffAccessToken(prepared.promptMessageId, apiKey);
      if (hashHumanHandoffAccessToken(accessToken) !== prepared.accessTokenHash) {
        return { kind: "definitive_failure" };
      }
      handoffUrl = humanHandoffUrl(
        humanHandoffOrigin(getRuntimeEnv("SITE_URL")),
        args.handoffId,
        accessToken,
      );
    } catch {
      return { kind: "definitive_failure" };
    }
    const client = createAgentMailInboxClient({ apiKey, inboxId: prepared.inboxId });
    return await runHumanHandoffDelivery(
      {
        handoffId: args.handoffId,
        inboxId: prepared.inboxId,
        recipientEmail: prepared.recipientEmail,
        scoutName: prepared.scoutName,
        handoffUrl,
      },
      {
        prepare: async () => ({
          kind: "ready",
          claimExpiresAt: prepared.claimExpiresAt,
        }),
        sendEmail: client.send,
      },
    );
  },
});
