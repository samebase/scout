import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { requireAppUser } from "../access";
import { canonicalCredentialHost, canonicalProductDomain, ensureProduct } from "../productsDomain";
import { scoutManagedPasswordLoginMethodValidator } from "./model";

const MAX_ACCOUNTS = 200;
const MAX_ACCOUNTS_PER_SCOUT = 50;
const MAX_SERVICE_NAME_LENGTH = 100;
const MAX_IDENTIFIER_LENGTH = 320;
const MAX_ENVELOPE_FIELD_LENGTH = 1_000;
const CREDENTIAL_REFERENCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const managedRegistrationArgsValidator = v.object({
  scoutId: v.id("scouts"),
  serviceName: v.string(),
  serviceDomain: v.string(),
  credentialHost: v.string(),
  identifier: v.string(),
});

const normalizedRegistrationValidator = v.object({
  scoutId: v.id("scouts"),
  serviceName: v.string(),
  serviceDomain: v.string(),
  credentialHost: v.string(),
  identifier: v.string(),
});

const encryptedCredentialValidator = v.object({
  credentialReference: v.string(),
  formatVersion: v.literal(1),
  algorithm: v.literal("aes-256-gcm"),
  keyVersion: v.literal(1),
  keyFingerprint: v.string(),
  nonce: v.string(),
  ciphertext: v.string(),
  authenticationTag: v.string(),
});

const managedRegistrationResultValidator = v.object({
  serviceAccountId: v.id("scoutServiceAccounts"),
  loginMethod: scoutManagedPasswordLoginMethodValidator,
});

const runtimeCredentialValidator = v.object({
  serviceAccountId: v.id("scoutServiceAccounts"),
  identifier: v.string(),
  serviceDomain: v.string(),
  credentialHost: v.string(),
  createdAt: v.number(),
  credentialReference: v.string(),
  formatVersion: v.literal(1),
  algorithm: v.literal("aes-256-gcm"),
  keyVersion: v.literal(1),
  keyFingerprint: v.string(),
  nonce: v.string(),
  ciphertext: v.string(),
  authenticationTag: v.string(),
});

function requiredText(value: string, label: string, maximumLength: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }
  if (trimmed.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer`);
  }
  return trimmed;
}

function normalizeRegistration(args: typeof managedRegistrationArgsValidator.type) {
  const credentialHost = canonicalCredentialHost(args.credentialHost);
  return {
    scoutId: args.scoutId,
    serviceName: requiredText(args.serviceName, "Service name", MAX_SERVICE_NAME_LENGTH),
    serviceDomain: canonicalProductDomain(args.serviceDomain, "Service domain"),
    credentialHost,
    identifier: requiredText(args.identifier, "Account identifier", MAX_IDENTIFIER_LENGTH),
  };
}

async function requireRegistrationAvailable(
  ctx: Pick<QueryCtx, "db">,
  registration: ReturnType<typeof normalizeRegistration>,
) {
  const scout = await ctx.db.get(registration.scoutId);
  if (!scout) {
    throw new Error("Scout not found");
  }

  const duplicate = await ctx.db
    .query("scoutServiceAccounts")
    .withIndex("by_scout_id_and_service_domain_and_identifier", (query) =>
      query
        .eq("scoutId", registration.scoutId)
        .eq("serviceDomain", registration.serviceDomain)
        .eq("identifier", registration.identifier),
    )
    .unique();
  if (duplicate) {
    throw new Error("Service account is already registered to this Scout");
  }
  const serviceAccounts = await ctx.db
    .query("scoutServiceAccounts")
    .withIndex("by_scout_id_and_service_domain", (query) =>
      query.eq("scoutId", registration.scoutId).eq("serviceDomain", registration.serviceDomain),
    )
    .take(MAX_ACCOUNTS_PER_SCOUT);
  if (serviceAccounts.some((account) => account.loginMethod.kind === "managed_password")) {
    throw new Error("This Scout already has a managed credential for the service");
  }

  const scoutAccounts = await ctx.db
    .query("scoutServiceAccounts")
    .withIndex("by_scout_id", (query) => query.eq("scoutId", registration.scoutId))
    .take(MAX_ACCOUNTS_PER_SCOUT);
  if (scoutAccounts.length >= MAX_ACCOUNTS_PER_SCOUT) {
    throw new Error(`A Scout can have at most ${MAX_ACCOUNTS_PER_SCOUT} service accounts`);
  }

  const allAccounts = await ctx.db
    .query("scoutServiceAccounts")
    .withIndex("by_scout_id")
    .take(MAX_ACCOUNTS);
  if (allAccounts.length >= MAX_ACCOUNTS) {
    throw new Error(`Service account inventory can contain at most ${MAX_ACCOUNTS} accounts`);
  }
}

function boundedEnvelopeField(value: string, label: string) {
  return requiredText(value, label, MAX_ENVELOPE_FIELD_LENGTH);
}

export const prepareManagedRegistration = internalQuery({
  args: managedRegistrationArgsValidator.fields,
  returns: normalizedRegistrationValidator,
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    const registration = normalizeRegistration(args);
    await requireRegistrationAvailable(ctx, registration);
    return registration;
  },
});

export const commitManagedRegistration = internalMutation({
  args: {
    ...managedRegistrationArgsValidator.fields,
    encryptedCredential: encryptedCredentialValidator,
  },
  returns: managedRegistrationResultValidator,
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    const registration = normalizeRegistration(args);
    await requireRegistrationAvailable(ctx, registration);

    const credentialReference = boundedEnvelopeField(
      args.encryptedCredential.credentialReference,
      "Credential reference",
    );
    if (!CREDENTIAL_REFERENCE_PATTERN.test(credentialReference)) {
      throw new Error("Credential reference is invalid");
    }
    const keyFingerprint = boundedEnvelopeField(
      args.encryptedCredential.keyFingerprint,
      "Credential key fingerprint",
    );
    const nonce = boundedEnvelopeField(args.encryptedCredential.nonce, "Credential nonce");
    const ciphertext = boundedEnvelopeField(
      args.encryptedCredential.ciphertext,
      "Credential ciphertext",
    );
    const authenticationTag = boundedEnvelopeField(
      args.encryptedCredential.authenticationTag,
      "Credential authentication tag",
    );

    const configuredKey = await ctx.db
      .query("scoutCredentialKeys")
      .withIndex("by_key_version", (query) =>
        query.eq("keyVersion", args.encryptedCredential.keyVersion),
      )
      .unique();
    if (configuredKey && configuredKey.keyFingerprint !== keyFingerprint) {
      throw new Error("Scout credential key does not match configured version");
    }
    if (!configuredKey) {
      const existingCredential = await ctx.db
        .query("scoutManagedCredentials")
        .withIndex("by_credential_reference")
        .first();
      if (existingCredential) {
        throw new Error("Scout credential key registry is missing for existing credentials");
      }
    }
    const duplicateReference = await ctx.db
      .query("scoutManagedCredentials")
      .withIndex("by_credential_reference", (query) =>
        query.eq("credentialReference", credentialReference),
      )
      .unique();
    if (duplicateReference) {
      throw new Error("Credential reference is already registered");
    }

    const createdAt = Date.now();
    if (!configuredKey) {
      await ctx.db.insert("scoutCredentialKeys", {
        keyVersion: args.encryptedCredential.keyVersion,
        keyFingerprint,
        createdAt,
      });
    }
    const product = await ensureProduct(ctx, {
      name: registration.serviceName,
      domain: registration.serviceDomain,
    });
    const loginMethod = {
      kind: "managed_password" as const,
      credentialHost: registration.credentialHost,
      createdAt,
    };
    const serviceAccountId = await ctx.db.insert("scoutServiceAccounts", {
      scoutId: registration.scoutId,
      productId: product.productId,
      serviceName: registration.serviceName,
      serviceDomain: registration.serviceDomain,
      identifier: registration.identifier,
      authenticationEvidence: { kind: "none" },
      loginMethod,
    });
    await ctx.db.insert("scoutManagedCredentials", {
      credentialReference,
      serviceAccountId,
      scoutId: registration.scoutId,
      formatVersion: args.encryptedCredential.formatVersion,
      algorithm: args.encryptedCredential.algorithm,
      keyVersion: args.encryptedCredential.keyVersion,
      keyFingerprint,
      credentialHost: registration.credentialHost,
      identifier: registration.identifier,
      nonce,
      ciphertext,
      authenticationTag,
      createdAt,
    });
    return { serviceAccountId, loginMethod };
  },
});

export const listRuntimeCredentialsForScout = internalQuery({
  args: { scoutId: v.id("scouts") },
  returns: v.array(runtimeCredentialValidator),
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id", (query) => query.eq("scoutId", args.scoutId))
      .take(MAX_ACCOUNTS_PER_SCOUT);
    const credentials: Array<typeof runtimeCredentialValidator.type> = [];
    for (const account of accounts) {
      if (account.loginMethod.kind !== "managed_password") continue;
      const credential = await ctx.db
        .query("scoutManagedCredentials")
        .withIndex("by_service_account_id", (query) => query.eq("serviceAccountId", account._id))
        .unique();
      if (
        !credential ||
        credential.scoutId !== account.scoutId ||
        credential.credentialHost !== account.loginMethod.credentialHost ||
        credential.identifier !== account.identifier ||
        credential.createdAt !== account.loginMethod.createdAt
      ) {
        throw new Error("Managed credential has an invalid service-account binding");
      }
      const configuredKey = await ctx.db
        .query("scoutCredentialKeys")
        .withIndex("by_key_version", (query) => query.eq("keyVersion", credential.keyVersion))
        .unique();
      if (!configuredKey || configuredKey.keyFingerprint !== credential.keyFingerprint) {
        throw new Error("Managed credential key registry is missing or inconsistent");
      }
      credentials.push({
        serviceAccountId: account._id,
        identifier: account.identifier,
        serviceDomain: account.serviceDomain,
        credentialHost: credential.credentialHost,
        createdAt: credential.createdAt,
        credentialReference: credential.credentialReference,
        formatVersion: credential.formatVersion,
        algorithm: credential.algorithm,
        keyVersion: credential.keyVersion,
        keyFingerprint: credential.keyFingerprint,
        nonce: credential.nonce,
        ciphertext: credential.ciphertext,
        authenticationTag: credential.authenticationTag,
      });
    }
    return credentials;
  },
});
