"use node";

import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, env } from "../_generated/server";
import {
  credentialKeyFingerprint,
  decodeCredentialMasterKey,
  encryptCredential,
  generateManagedPassword,
  SCOUT_CREDENTIAL_ALGORITHM,
  SCOUT_CREDENTIAL_FORMAT_VERSION,
  SCOUT_CREDENTIAL_KEY_VERSION,
} from "./credentialCrypto";
import { scoutManagedCredentialMetadataValidator } from "./model";

type NormalizedRegistration = {
  scoutId: Id<"scouts">;
  serviceName: string;
  serviceDomain: string;
  credentialHost: string;
  identifier: string;
};

type ManagedRegistrationResult = {
  serviceAccountId: Id<"scoutServiceAccounts">;
  managedCredential: {
    kind: "managed";
    status: "prepared";
    credentialHost: string;
    createdAt: number;
  };
};

export const registerManaged = action({
  args: {
    scoutId: v.id("scouts"),
    serviceName: v.string(),
    serviceDomain: v.string(),
    credentialHost: v.string(),
    identifier: v.string(),
  },
  returns: v.object({
    serviceAccountId: v.id("scoutServiceAccounts"),
    managedCredential: scoutManagedCredentialMetadataValidator,
  }),
  handler: async (ctx, args): Promise<ManagedRegistrationResult> => {
    const registration: NormalizedRegistration = await ctx.runQuery(
      internal.scout.serviceAccountCredentials.prepareManagedRegistration,
      args,
    );
    const key = decodeCredentialMasterKey(env.SCOUT_CREDENTIAL_MASTER_KEY_V1);
    try {
      const credentialReference = randomUUID();
      const keyFingerprint = credentialKeyFingerprint(key);
      const encrypted = encryptCredential(generateManagedPassword(), key, {
        credentialReference,
        scoutId: registration.scoutId,
        serviceDomain: registration.serviceDomain,
        credentialHost: registration.credentialHost,
        identifier: registration.identifier,
        keyFingerprint,
      });
      return await ctx.runMutation(
        internal.scout.serviceAccountCredentials.commitManagedRegistration,
        {
          scoutId: registration.scoutId,
          serviceName: registration.serviceName,
          serviceDomain: registration.serviceDomain,
          credentialHost: registration.credentialHost,
          identifier: registration.identifier,
          encryptedCredential: {
            credentialReference,
            formatVersion: SCOUT_CREDENTIAL_FORMAT_VERSION,
            algorithm: SCOUT_CREDENTIAL_ALGORITHM,
            keyVersion: SCOUT_CREDENTIAL_KEY_VERSION,
            keyFingerprint,
            ...encrypted,
          },
        },
      );
    } finally {
      key.fill(0);
    }
  },
});
