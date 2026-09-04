import { internal } from "../_generated/api";
import { action, env } from "../_generated/server";
import { createAgentMailInboxClient, requiredAgentMailApiKey } from "./lib/agentMail";
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
    const agentMail = createAgentMailInboxClient({
      apiKey: requiredAgentMailApiKey(env.AGENTMAIL_API_KEY),
      inboxId: registration.agentMail.inboxId,
    });
    await agentMail.verifyAddress(registration.agentMail.address, {
      timeoutMs: AGENTMAIL_INBOX_LOOKUP_TIMEOUT_MS,
    });
    return await ctx.runMutation(internal.scout.scouts.commitRegistration, registration);
  },
});
