"use node";

import { randomUUID } from "node:crypto";
import { internal } from "../_generated/api";
import { action, env, type ActionCtx } from "../_generated/server";
import {
  credentialKeyFingerprint,
  decodeCredentialMasterKey,
  encryptCredential,
  generateManagedPassword,
  SCOUT_CREDENTIAL_ALGORITHM,
  SCOUT_CREDENTIAL_FORMAT_VERSION,
  SCOUT_CREDENTIAL_KEY_VERSION,
} from "./credentialCrypto";
import {
  managedRegistrationArgsValidator,
  managedRegistrationResultValidator,
  type managedRegistrationRequestValidator,
} from "./serviceAccountCredentials";

export const registerManaged = action({
  args: managedRegistrationArgsValidator.fields,
  returns: managedRegistrationResultValidator,
  handler: async (ctx, args) => await prepareManagedPassword(ctx, { kind: "profile", ...args }),
});

export async function prepareManagedPassword(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  request: typeof managedRegistrationRequestValidator.type,
): Promise<typeof managedRegistrationResultValidator.type> {
  const { registration, existing } = await ctx.runQuery(
    internal.scout.serviceAccountCredentials.prepareManagedRegistration,
    { request },
  );
  if (existing) return existing;
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
        request,
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
}
