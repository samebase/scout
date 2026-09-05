import { internal } from "../_generated/api";
import { action, env } from "../_generated/server";
import { ConvexError } from "convex/values";
import { createAgentMailInboxClient } from "./lib/agentMail";
import {
  registrationResultValidator,
  scoutRegistrationFieldsValidator,
  type PreparedScoutRegistration,
  type ScoutRegistrationResult,
} from "./scouts";

const AGENTMAIL_INBOX_LOOKUP_TIMEOUT_MS = 10_000;

export const register = action({
  args: scoutRegistrationFieldsValidator.fields,
  returns: registrationResultValidator,
  handler: async (ctx, args): Promise<ScoutRegistrationResult> => {
    const registration: PreparedScoutRegistration = await ctx.runQuery(
      internal.scout.scouts.prepareRegistration,
      args,
    );
    const apiKey = env.AGENTMAIL_API_KEY?.trim();
    if (!apiKey) {
      throw new ConvexError(
        "Scout email is not configured on this deployment. Ask the administrator to configure AgentMail.",
      );
    }
    const agentMail = createAgentMailInboxClient({
      apiKey,
      inboxId: registration.agentMail.inboxId,
    });
    await agentMail.verifyAddress(registration.agentMail.address, {
      timeoutMs: AGENTMAIL_INBOX_LOOKUP_TIMEOUT_MS,
    });
    return await ctx.runMutation(internal.scout.scouts.commitRegistration, registration);
  },
});
