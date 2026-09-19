import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { observedLoginMethodValidator } from "../scout/model";
import {
  agentsApiAccountScopeValidator,
  requireAgentsApiAccountScope,
  runtimeCredentialValidator,
} from "../scout/serviceAccountCredentials";
import { recordObservedAccount } from "../scout/serviceAccounts";

export const credentialForSession = internalQuery({
  args: agentsApiAccountScopeValidator.fields,
  returns: runtimeCredentialValidator,
  handler: async (ctx, args): Promise<typeof runtimeCredentialValidator.type> => {
    const { scout, url } = await requireAgentsApiAccountScope(ctx, args);
    const credentials: Array<typeof runtimeCredentialValidator.type> = await ctx.runQuery(
      internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout,
      { scoutId: scout._id },
    );
    const matches = credentials.filter((credential) => credential.credentialHost === url.hostname);
    if (matches.length !== 1 || !matches[0]) {
      throw new Error(
        "This Scout must have exactly one managed password for the current login host",
      );
    }
    return matches[0];
  },
});

export const recordAuthenticated = internalMutation({
  args: agentsApiAccountScopeValidator.extend({
    observationStartedAt: v.number(),
    identifier: v.string(),
    loginMethod: observedLoginMethodValidator,
    accountAccess: v.union(v.literal("created"), v.literal("recovered")),
    verification: v.string(),
  }).fields,
  returns: v.object({ serviceAccountId: v.id("scoutServiceAccounts"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const { scout, url } = await requireAgentsApiAccountScope(ctx, args);
    const verification = args.verification.trim();
    if (!verification || verification.length > 1000) {
      throw new Error("Authentication verification must contain 1 to 1000 characters");
    }
    url.search = "";
    url.hash = "";
    return await recordObservedAccount(ctx, {
      scoutId: scout._id,
      observedUrl: url.href,
      identifier: args.identifier,
      loginMethod: args.loginMethod,
      observationStartedAt: args.observationStartedAt,
      lastObserved: {
        kind: "task_report",
        taskSessionId: args.sessionId,
        observedUrl: url.href,
        recordedAt: Date.now(),
        accountAccess: args.accountAccess,
        verification,
      },
    });
  },
});
