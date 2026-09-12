import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { canonicalServiceDomain } from "../serviceDomains";
import {
  agentsApiAccountScopeValidator,
  requireAgentsApiAccountScope,
  runtimeCredentialValidator,
} from "../scout/serviceAccountCredentials";
import { serviceAccountIdentifierKey } from "../scout/serviceAccounts";

const MAX_ACCOUNTS_PER_SCOUT = 50;
const MAX_ACCOUNTS = 200;

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

function accountIdentifier(value: string) {
  const identifier = value.trim();
  if (!identifier || identifier.length > 320)
    throw new Error("Account identifier must contain 1 to 320 characters");
  return identifier;
}

export const recordAuthenticated = internalMutation({
  args: agentsApiAccountScopeValidator.extend({
    observationStartedAt: v.number(),
    identifier: v.string(),
    loginMethod: v.union(
      v.object({ kind: v.literal("managed_password") }),
      v.object({
        kind: v.literal("oauth"),
        providerServiceDomain: v.string(),
        providerIdentifier: v.string(),
      }),
    ),
  }).fields,
  returns: v.object({ serviceAccountId: v.id("scoutServiceAccounts"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const { scout, url } = await requireAgentsApiAccountScope(ctx, args);
    const observedDomain = canonicalServiceDomain(url.href);
    const identifier = accountIdentifier(args.identifier);
    const identifierKey = serviceAccountIdentifierKey(identifier);
    const accounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id", (q) => q.eq("scoutId", scout._id))
      .take(MAX_ACCOUNTS_PER_SCOUT);
    const serviceAccounts = accounts.filter(
      (account) =>
        observedDomain === account.serviceDomain ||
        observedDomain.endsWith(`.${account.serviceDomain}`),
    );
    if (
      serviceAccounts.some(
        (account) =>
          account.loginUpdatedAt !== undefined &&
          args.observationStartedAt <= account.loginUpdatedAt,
      )
    ) {
      throw new Error(
        "Account login settings changed. Read the current page again before recording authentication.",
      );
    }
    const matchingAccounts = serviceAccounts.filter(
      (account) => serviceAccountIdentifierKey(account.identifier) === identifierKey,
    );
    if (matchingAccounts.length > 1)
      throw new Error("The login identifier must match exactly one Scout service account");
    const account = matchingAccounts[0];
    const authenticationEvidence = { kind: "succeeded", checkedAt: Date.now() } as const;
    if (args.loginMethod.kind === "managed_password") {
      if (!account || account.loginMethod.kind !== "managed_password") {
        throw new Error(
          "A matching managed-password account must be registered before authentication is recorded",
        );
      }
      await ctx.db.patch("scoutServiceAccounts", account._id, { authenticationEvidence });
      return { serviceAccountId: account._id, created: false };
    }
    const providerDomain = canonicalServiceDomain(args.loginMethod.providerServiceDomain);
    const providerIdentifier = accountIdentifier(args.loginMethod.providerIdentifier);
    const provider = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id_and_service_domain_and_identifier", (q) =>
        q
          .eq("scoutId", scout._id)
          .eq("serviceDomain", providerDomain)
          .eq("identifier", providerIdentifier),
      )
      .unique();
    if (!provider) throw new Error("OAuth provider account is not registered to this Scout");
    if (account) {
      if (account._id === provider._id)
        throw new Error("A service account cannot authenticate through itself");
      if (
        account.loginMethod.kind !== "oauth" ||
        account.loginMethod.providerAccountId !== provider._id
      ) {
        throw new Error("Observed login method does not match the registered service account");
      }
      await ctx.db.patch("scoutServiceAccounts", account._id, { authenticationEvidence });
      return { serviceAccountId: account._id, created: false };
    }
    const ownedIdentifier = [
      scout.agentMail.address,
      ...accounts.map((entry) => entry.identifier),
    ].find((value) => serviceAccountIdentifierKey(value) === identifierKey);
    if (!ownedIdentifier) throw new Error("The account identifier does not belong to this Scout");
    if (accounts.length >= MAX_ACCOUNTS_PER_SCOUT)
      throw new Error("This Scout's service account inventory is full");
    const allAccounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id")
      .take(MAX_ACCOUNTS);
    if (allAccounts.length >= MAX_ACCOUNTS)
      throw new Error("The service account inventory is full");
    const serviceAccountId = await ctx.db.insert("scoutServiceAccounts", {
      scoutId: scout._id,
      serviceName: observedDomain,
      serviceDomain: observedDomain,
      identifier: ownedIdentifier,
      authenticationEvidence,
      loginMethod: { kind: "oauth", providerAccountId: provider._id },
    });
    return { serviceAccountId, created: true };
  },
});
