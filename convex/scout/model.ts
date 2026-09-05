import { v } from "convex/values";

export const scoutWebsiteIdentityValidator = v.object({
  firstName: v.string(),
  lastName: v.string(),
});

export const scoutServiceAccountAuthenticationEvidenceValidator = v.union(
  v.object({
    kind: v.literal("none"),
  }),
  v.object({
    kind: v.literal("succeeded"),
    checkedAt: v.number(),
  }),
  v.object({
    kind: v.literal("failed"),
    checkedAt: v.number(),
    lastSucceededAt: v.optional(v.number()),
  }),
);

export const scoutManagedPasswordLoginMethodValidator = v.object({
  kind: v.literal("managed_password"),
  credentialHost: v.string(),
  createdAt: v.number(),
});

export const scoutServiceAccountLoginMethodValidator = v.union(
  scoutManagedPasswordLoginMethodValidator,
  v.object({
    kind: v.literal("oauth"),
    providerAccountId: v.id("scoutServiceAccounts"),
  }),
);

export const scoutServiceAccountFieldsValidator = v.object({
  scoutId: v.id("scouts"),
  serviceName: v.string(),
  serviceDomain: v.string(),
  identifier: v.string(),
  authenticationEvidence: scoutServiceAccountAuthenticationEvidenceValidator,
  loginMethod: scoutServiceAccountLoginMethodValidator,
});

export const profileAccountUpdateValidator = v.object({
  kind: v.literal("update"),
  serviceAccountId: v.id("scoutServiceAccounts"),
  identifier: v.string(),
});

export const profileAccountTargetValidator = v.union(
  scoutServiceAccountFieldsValidator
    .pick("scoutId", "serviceName", "serviceDomain", "identifier")
    .extend({ kind: v.literal("create") }),
  profileAccountUpdateValidator,
);
