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

export const scoutManagedCredentialMetadataValidator = v.object({
  kind: v.literal("managed"),
  status: v.literal("prepared"),
  credentialHost: v.string(),
  createdAt: v.number(),
});

export const scoutServiceAccountFieldsValidator = v.object({
  scoutId: v.id("scouts"),
  serviceName: v.string(),
  serviceDomain: v.string(),
  identifier: v.string(),
  authenticationEvidence: scoutServiceAccountAuthenticationEvidenceValidator,
  managedCredential: v.optional(scoutManagedCredentialMetadataValidator),
});
