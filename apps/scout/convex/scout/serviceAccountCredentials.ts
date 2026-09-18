import { requireRunnableThread } from "./chatAccess";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { requirePermission } from "../access";
import { canonicalCredentialHost, canonicalServiceDomain } from "../serviceDomains";
import { scoutManagedPasswordLoginMethodValidator, profileAccountUpdateValidator } from "./model";
import { resolveProfileAccount, serviceAccountIdentifierKey } from "./serviceAccounts";

const MAX_ACCOUNTS = 200;
const MAX_ACCOUNTS_PER_SCOUT = 50;
const MAX_SERVICE_NAME_LENGTH = 100;
const MAX_IDENTIFIER_LENGTH = 320;
const MAX_ENVELOPE_FIELD_LENGTH = 1_000;
const CREDENTIAL_REFERENCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const managedRegistrationArgsValidator = v.object({
  scoutId: v.id("scouts"),
  serviceName: v.string(),
  serviceDomain: v.string(),
  credentialHost: v.string(),
  identifier: v.string(),
});

export const agentsApiAccountScopeValidator = v.object({
  sessionId: v.id("agentsApiSessions"),
  scoutId: v.id("scouts"),
  observedUrl: v.string(),
});

export const managedRegistrationRequestValidator = v.union(
  managedRegistrationArgsValidator.extend({ kind: v.literal("profile") }),
  profileAccountUpdateValidator.omit("kind").extend({
    kind: v.literal("profile_update"),
    credentialHost: v.string(),
  }),
  v.object({
    kind: v.literal("browser"),
    sessionId: v.id("scoutBrowserSessions"),
    observedUrl: v.string(),
    serviceName: v.string(),
    serviceDomain: v.string(),
    identifier: v.string(),
  }),
  agentsApiAccountScopeValidator.extend({
    kind: v.literal("agents_api"),
    serviceName: v.string(),
    serviceDomain: v.string(),
    identifier: v.string(),
  }),
);

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

export const managedRegistrationResultValidator = v.object({
  serviceAccountId: v.id("scoutServiceAccounts"),
  loginMethod: scoutManagedPasswordLoginMethodValidator,
});

export const runtimeCredentialValidator = v.object({
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
  try {
    return {
      scoutId: args.scoutId,
      serviceName: requiredText(args.serviceName, "Service name", MAX_SERVICE_NAME_LENGTH),
      serviceDomain: canonicalServiceDomain(args.serviceDomain),
      credentialHost: canonicalCredentialHost(args.credentialHost),
      identifier: requiredText(args.identifier, "Account identifier", MAX_IDENTIFIER_LENGTH),
    };
  } catch (error) {
    throw new ConvexError(error instanceof Error ? error.message : "Invalid account details.");
  }
}

export async function requireAgentsApiAccountScope(
  ctx: Pick<QueryCtx, "runQuery">,
  args: typeof agentsApiAccountScopeValidator.type,
): Promise<{ scout: Doc<"scouts">; url: URL }> {
  const { session, scout }: { session: Doc<"agentsApiSessions">; scout: Doc<"scouts"> } =
    await ctx.runQuery(internal.tasks.sessions.runtime, { sessionId: args.sessionId });
  if (session.state.kind !== "running" || !session.browser) {
    throw new Error("Running Agents API browser session not found");
  }
  if (session.scoutId !== args.scoutId) {
    throw new Error("Agents API session does not belong to this Scout");
  }
  const url = new URL(requiredText(args.observedUrl, "Current browser URL", 2_048));
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Account tools require an HTTPS page without credentials or a port");
  }
  canonicalCredentialHost(url.hostname);
  return { scout, url };
}

async function resolveRegistration(
  ctx: Pick<QueryCtx, "auth" | "db" | "runQuery">,
  request: typeof managedRegistrationRequestValidator.type,
): Promise<typeof normalizedRegistrationValidator.type> {
  switch (request.kind) {
    case "profile":
      await requirePermission(ctx, "access_scout_manage");
      return normalizeRegistration(request);
    case "profile_update": {
      const { registration } = await resolveProfileAccount(ctx, {
        kind: "update",
        serviceAccountId: request.serviceAccountId,
        identifier: request.identifier,
      });
      return normalizeRegistration({ ...registration, credentialHost: request.credentialHost });
    }
    case "agents_api": {
      const { scout, url } = await requireAgentsApiAccountScope(ctx, request);
      const serviceDomain = canonicalServiceDomain(request.serviceDomain);
      if (url.hostname !== serviceDomain && !url.hostname.endsWith(`.${serviceDomain}`)) {
        throw new Error("The signup host must belong to the requested service domain");
      }
      const identifier = requiredText(
        request.identifier,
        "Account identifier",
        MAX_IDENTIFIER_LENGTH,
      );
      if (
        identifier.includes("@") &&
        identifier.toLowerCase() !== scout.agentMail.address.toLowerCase()
      ) {
        throw new Error("Use this Scout's own email address for account signup");
      }
      const accounts = await ctx.db
        .query("scoutServiceAccounts")
        .withIndex("by_scout_id", (query) => query.eq("scoutId", scout._id))
        .take(MAX_ACCOUNTS_PER_SCOUT);
      const hostAccounts = accounts.filter(
        (account) =>
          account.loginMethod.kind === "managed_password" &&
          account.loginMethod.credentialHost === url.hostname,
      );
      if (hostAccounts.length > 1) throw new Error("Multiple managed accounts use this login host");
      const existing = hostAccounts[0];
      if (
        existing &&
        (existing.identifier !== identifier || existing.serviceDomain !== serviceDomain)
      ) {
        throw new Error(
          "A password is already prepared for a different account on this login host",
        );
      }
      return normalizeRegistration({
        scoutId: scout._id,
        serviceName: existing?.serviceName ?? request.serviceName,
        serviceDomain,
        credentialHost: url.hostname,
        identifier,
      });
    }
    case "browser": {
      const session = await ctx.db.get("scoutBrowserSessions", request.sessionId);
      if (!session || session.lifecycle.kind !== "active") {
        throw new Error("Active Scout browser session not found");
      }
      const chat = await ctx.db
        .query("scoutChats")
        .withIndex("by_thread_id", (query) => query.eq("threadId", session.threadId))
        .unique();
      if (!chat || chat.scoutId !== session.scoutId) {
        throw new Error("Browser session does not match its Scout chat");
      }
      await requireRunnableThread(ctx, chat.threadId);
      const latestOperation = await ctx.db
        .query("scoutBrowserOperations")
        .withIndex("by_session_id_and_sequence", (query) => query.eq("sessionId", session._id))
        .order("desc")
        .first();
      if (
        !latestOperation ||
        (latestOperation.state.kind !== "applied" &&
          latestOperation.state.kind !== "applied_snapshot_failed")
      ) {
        throw new Error("Observe the signup page before preparing an account password");
      }
      const observedUrl = new URL(request.observedUrl);
      if (
        observedUrl.protocol !== "https:" ||
        observedUrl.username ||
        observedUrl.password ||
        observedUrl.port
      ) {
        throw new Error(
          "Account passwords require an HTTPS signup page without credentials or a port",
        );
      }
      observedUrl.search = "";
      observedUrl.hash = "";
      const serviceDomain = canonicalServiceDomain(request.serviceDomain);
      if (
        observedUrl.hostname !== serviceDomain &&
        !observedUrl.hostname.endsWith(`.${serviceDomain}`)
      ) {
        throw new Error("The signup host must belong to the requested service domain");
      }
      const activeTab = latestOperation.state.telemetry.after.tabs.find((tab) => tab.active);
      if (activeTab?.url !== observedUrl.href) {
        throw new Error("The signup page does not match the latest browser observation");
      }
      const scout = await ctx.db.get("scouts", chat.scoutId);
      if (!scout || scout.status !== "active") throw new Error("Active Scout not found");
      const identifier = requiredText(
        request.identifier,
        "Account identifier",
        MAX_IDENTIFIER_LENGTH,
      );
      if (
        identifier.includes("@") &&
        identifier.toLowerCase() !== scout.agentMail.address.toLowerCase()
      ) {
        throw new Error("Use this Scout's own email address for account signup");
      }
      const accounts = await ctx.db
        .query("scoutServiceAccounts")
        .withIndex("by_scout_id", (query) => query.eq("scoutId", chat.scoutId))
        .take(MAX_ACCOUNTS_PER_SCOUT);
      const hostAccounts = accounts.filter(
        (account) =>
          account.loginMethod.kind === "managed_password" &&
          account.loginMethod.credentialHost === observedUrl.hostname,
      );
      if (hostAccounts.length > 1) throw new Error("Multiple managed accounts use this login host");
      const existing = hostAccounts[0];
      if (existing && existing.identifier !== identifier) {
        throw new Error(
          "A password is already prepared for a different identifier on this login host",
        );
      }
      return normalizeRegistration({
        scoutId: chat.scoutId,
        serviceName: existing?.serviceName ?? request.serviceName,
        serviceDomain: existing?.serviceDomain ?? serviceDomain,
        credentialHost: observedUrl.hostname,
        identifier,
      });
    }
  }
}

async function requireRegistrationAvailable(
  ctx: Pick<QueryCtx, "db">,
  registration: ReturnType<typeof normalizeRegistration>,
  reuseExisting: boolean,
  updatedAccountId: Doc<"scoutServiceAccounts">["_id"] | null,
) {
  const scout = await ctx.db.get(registration.scoutId);
  if (!scout || scout.status !== "active") {
    throw new ConvexError("Active Scout not found");
  }

  const serviceAccounts = await ctx.db
    .query("scoutServiceAccounts")
    .withIndex("by_scout_id_and_service_domain", (query) =>
      query.eq("scoutId", registration.scoutId).eq("serviceDomain", registration.serviceDomain),
    )
    .take(MAX_ACCOUNTS_PER_SCOUT);
  const duplicate = serviceAccounts.find(
    (account) =>
      serviceAccountIdentifierKey(account.identifier) ===
        serviceAccountIdentifierKey(registration.identifier) && account._id !== updatedAccountId,
  );
  if (duplicate) {
    if (
      reuseExisting &&
      duplicate.loginMethod.kind === "managed_password" &&
      duplicate.loginMethod.credentialHost === registration.credentialHost
    ) {
      await runtimeCredentialForAccount(ctx, duplicate);
      return { serviceAccountId: duplicate._id, loginMethod: duplicate.loginMethod };
    }
    throw new ConvexError("Service account is already registered to this Scout");
  }
  if (
    serviceAccounts.some(
      (account) =>
        account._id !== updatedAccountId && account.loginMethod.kind === "managed_password",
    )
  ) {
    throw new ConvexError(
      "This Scout already has a managed credential for the service. Edit its login instead.",
    );
  }

  if (updatedAccountId !== null) return null;

  const scoutAccounts = await ctx.db
    .query("scoutServiceAccounts")
    .withIndex("by_scout_id", (query) => query.eq("scoutId", registration.scoutId))
    .take(MAX_ACCOUNTS_PER_SCOUT);
  if (scoutAccounts.length >= MAX_ACCOUNTS_PER_SCOUT) {
    throw new ConvexError(`A Scout can have at most ${MAX_ACCOUNTS_PER_SCOUT} service accounts`);
  }

  const allAccounts = await ctx.db
    .query("scoutServiceAccounts")
    .withIndex("by_scout_id")
    .take(MAX_ACCOUNTS);
  if (allAccounts.length >= MAX_ACCOUNTS) {
    throw new ConvexError(`Service account inventory can contain at most ${MAX_ACCOUNTS} accounts`);
  }
  return null;
}

function boundedEnvelopeField(value: string, label: string) {
  return requiredText(value, label, MAX_ENVELOPE_FIELD_LENGTH);
}

export const prepareManagedRegistration = internalQuery({
  args: { request: managedRegistrationRequestValidator },
  returns: v.object({
    registration: normalizedRegistrationValidator,
    existing: v.union(managedRegistrationResultValidator, v.null()),
  }),
  handler: async (ctx, { request }) => {
    const registration = await resolveRegistration(ctx, request);
    const existing = await requireRegistrationAvailable(
      ctx,
      registration,
      request.kind === "browser" || request.kind === "agents_api",
      request.kind === "profile_update" ? request.serviceAccountId : null,
    );
    return { registration, existing };
  },
});

export const commitManagedRegistration = internalMutation({
  args: {
    request: managedRegistrationRequestValidator,
    encryptedCredential: encryptedCredentialValidator,
  },
  returns: managedRegistrationResultValidator,
  handler: async (ctx, args) => {
    const registration = await resolveRegistration(ctx, args.request);
    const existing = await requireRegistrationAvailable(
      ctx,
      registration,
      args.request.kind === "browser" || args.request.kind === "agents_api",
      args.request.kind === "profile_update" ? args.request.serviceAccountId : null,
    );
    if (existing) return existing;

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
    const ciphertext = requiredText(
      args.encryptedCredential.ciphertext,
      "Credential ciphertext",
      4_096,
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
    const loginMethod = {
      kind: "managed_password" as const,
      credentialHost: registration.credentialHost,
      createdAt,
    };
    const accountFields = {
      scoutId: registration.scoutId,
      serviceName: registration.serviceName,
      serviceDomain: registration.serviceDomain,
      identifier: registration.identifier,
      authenticationEvidence: { kind: "none" as const },
      loginMethod,
    };
    const serviceAccountId =
      args.request.kind === "profile_update"
        ? args.request.serviceAccountId
        : await ctx.db.insert("scoutServiceAccounts", accountFields);
    if (args.request.kind === "profile_update") {
      await ctx.db.patch("scoutServiceAccounts", serviceAccountId, {
        ...accountFields,
        lastObserved: undefined,
        loginUpdatedAt: createdAt,
      });
      const previous = await ctx.db
        .query("scoutManagedCredentials")
        .withIndex("by_service_account_id", (q) => q.eq("serviceAccountId", serviceAccountId))
        .unique();
      if (previous) await ctx.db.delete("scoutManagedCredentials", previous._id);
    }
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

async function runtimeCredentialForAccount(
  ctx: Pick<QueryCtx, "db">,
  account: Doc<"scoutServiceAccounts">,
) {
  if (account.loginMethod.kind !== "managed_password") return null;
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
  return {
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
  };
}

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
      const credential = await runtimeCredentialForAccount(ctx, account);
      if (credential) credentials.push(credential);
    }
    return credentials;
  },
});
