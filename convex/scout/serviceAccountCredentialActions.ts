"use node";

import { randomUUID } from "node:crypto";
import { ConvexError, v } from "convex/values";
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
  managedRegistrationResultValidator,
  type managedRegistrationRequestValidator,
} from "./serviceAccountCredentials";
import { profileAccountTargetValidator } from "./model";

const passwordChoiceValidator = v.union(
  v.object({ kind: v.literal("generate") }),
  v.object({ kind: v.literal("provided"), value: v.string() }),
);

export const savePassword = action({
  args: {
    account: profileAccountTargetValidator,
    credentialHost: v.string(),
    password: passwordChoiceValidator,
  },
  returns: managedRegistrationResultValidator,
  handler: async (ctx, { account, credentialHost, password }) => {
    const request =
      account.kind === "create"
        ? { ...account, kind: "profile" as const, credentialHost }
        : { ...account, kind: "profile_update" as const, credentialHost };
    return await storeManagedPassword(ctx, request, password);
  },
});

export async function prepareManagedPassword(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  request: typeof managedRegistrationRequestValidator.type,
): Promise<typeof managedRegistrationResultValidator.type> {
  return await storeManagedPassword(ctx, request, { kind: "generate" });
}

async function storeManagedPassword(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  request: typeof managedRegistrationRequestValidator.type,
  password: typeof passwordChoiceValidator.type,
): Promise<typeof managedRegistrationResultValidator.type> {
  const { registration, existing } = await ctx.runQuery(
    internal.scout.serviceAccountCredentials.prepareManagedRegistration,
    { request },
  );
  if (existing) return existing;
  if (
    password.kind === "provided" &&
    (password.value.length === 0 || password.value.length > 1_024)
  ) {
    throw new ConvexError("Enter a password between 1 and 1,024 characters.");
  }
  let key;
  try {
    key = decodeCredentialMasterKey(env.SCOUT_CREDENTIAL_MASTER_KEY_V1);
  } catch {
    throw new ConvexError("Password storage is not configured for this deployment.");
  }
  try {
    const credentialReference = randomUUID();
    const keyFingerprint = credentialKeyFingerprint(key);
    const encrypted = encryptCredential(
      password.kind === "provided" ? password.value : generateManagedPassword(),
      key,
      {
        credentialReference,
        scoutId: registration.scoutId,
        serviceDomain: registration.serviceDomain,
        credentialHost: registration.credentialHost,
        identifier: registration.identifier,
        keyFingerprint,
      },
    );
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
