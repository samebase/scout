import { requireLabThread } from "./chatAccess";
import { mutation, query } from "../functions";
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requirePermission } from "../access";
import { accountObservationValidator } from "../schema";
import { canonicalServiceDomain } from "../serviceDomains";
import {
  scoutServiceAccountAuthenticationEvidenceValidator,
  scoutServiceAccountFieldsValidator,
  scoutServiceAccountLoginMethodValidator,
  profileAccountTargetValidator,
} from "./model";

const MAX_ACCOUNTS = 200;
const MAX_ACCOUNTS_PER_SCOUT = 50;
const MAX_IDENTIFIER_LENGTH = 320;
const MAX_OBSERVED_URL_LENGTH = 2_048;

const serviceAccountPublicValidator = scoutServiceAccountFieldsValidator.extend({
  _id: v.id("scoutServiceAccounts"),
  lastObserved: v.union(accountObservationValidator, v.null()),
});

const observedLoginMethodValidator = v.union(
  v.object({ kind: v.literal("managed_password") }),
  v.object({
    kind: v.literal("oauth"),
    providerServiceDomain: v.string(),
    providerIdentifier: v.string(),
  }),
);

const runtimeServiceAccountValidator = v.object({
  serviceAccountId: v.id("scoutServiceAccounts"),
  serviceName: v.string(),
  serviceDomain: v.string(),
  identifier: v.string(),
  loginMethod: scoutServiceAccountLoginMethodValidator,
  authenticationEvidence: scoutServiceAccountAuthenticationEvidenceValidator,
});

const serviceAccountRecordingResultValidator = v.object({
  serviceAccountId: v.id("scoutServiceAccounts"),
  created: v.boolean(),
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

function canonicalIdentifier(value: string) {
  return requiredText(value, "Account identifier", MAX_IDENTIFIER_LENGTH);
}

export async function resolveProfileAccount(
  ctx: Pick<QueryCtx, "auth" | "db">,
  target: typeof profileAccountTargetValidator.type,
) {
  await requirePermission(ctx, "access_scout_manage");
  const account =
    target.kind === "update"
      ? await ctx.db.get("scoutServiceAccounts", target.serviceAccountId)
      : null;
  const fields = target.kind === "create" ? target : account;
  if (!fields) throw new ConvexError("Account not found.");
  const scout = await ctx.db.get("scouts", fields.scoutId);
  if (!scout || scout.status !== "active") throw new ConvexError("Active Scout not found.");
  if (account?.loginMethod.kind === "managed_password") {
    for (const kind of ["active", "closing"] as const) {
      const session = await ctx.db
        .query("scoutBrowserSessions")
        .withIndex("by_scout_id_and_lifecycle_kind", (q) =>
          q.eq("scoutId", scout._id).eq("lifecycle.kind", kind),
        )
        .first();
      if (session) {
        throw new ConvexError(
          "Close this Scout's browser before changing an existing password login.",
        );
      }
    }
  }
  let registration;
  try {
    registration = {
      scoutId: scout._id,
      serviceName: requiredText(fields.serviceName, "Service name", 100),
      serviceDomain: canonicalServiceDomain(fields.serviceDomain),
      identifier: canonicalIdentifier(target.identifier),
    };
  } catch (error) {
    throw new ConvexError(error instanceof Error ? error.message : "Invalid account details.");
  }
  const serviceAccounts = await ctx.db
    .query("scoutServiceAccounts")
    .withIndex("by_scout_id_and_service_domain", (q) =>
      q.eq("scoutId", scout._id).eq("serviceDomain", registration.serviceDomain),
    )
    .take(MAX_ACCOUNTS_PER_SCOUT);
  const duplicate = serviceAccounts.find(
    (candidate) =>
      serviceAccountIdentifierKey(candidate.identifier) ===
        serviceAccountIdentifierKey(registration.identifier) && candidate._id !== account?._id,
  );
  if (duplicate) throw new ConvexError("That account is already registered for this Scout.");
  if (!account) {
    const scoutAccounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id", (q) => q.eq("scoutId", scout._id))
      .take(MAX_ACCOUNTS_PER_SCOUT);
    if (scoutAccounts.length >= MAX_ACCOUNTS_PER_SCOUT)
      throw new ConvexError(`A Scout can have at most ${MAX_ACCOUNTS_PER_SCOUT} accounts.`);
    const allAccounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id")
      .take(MAX_ACCOUNTS);
    if (allAccounts.length >= MAX_ACCOUNTS)
      throw new ConvexError("The service account inventory is full.");
  }
  return { registration, account };
}

export const saveOAuth = mutation({
  access: "access_scout_manage",
  args: { account: profileAccountTargetValidator, providerAccountId: v.id("scoutServiceAccounts") },
  returns: v.object({ serviceAccountId: v.id("scoutServiceAccounts") }),
  handler: async (ctx, args) => {
    const { registration, account } = await resolveProfileAccount(ctx, args.account);
    const visited = new Set(account ? [account._id] : []);
    let providerId = args.providerAccountId;
    while (true) {
      if (visited.has(providerId) || visited.size >= MAX_ACCOUNTS_PER_SCOUT) {
        throw new ConvexError("Choose a provider that does not sign in through this account.");
      }
      visited.add(providerId);
      const provider = await ctx.db.get("scoutServiceAccounts", providerId);
      if (!provider || provider.scoutId !== registration.scoutId) {
        throw new ConvexError("Choose a provider account belonging to this Scout.");
      }
      if (provider.loginMethod.kind === "managed_password") break;
      providerId = provider.loginMethod.providerAccountId;
    }
    const fields = {
      ...registration,
      authenticationEvidence: { kind: "none" as const },
      loginMethod: { kind: "oauth" as const, providerAccountId: args.providerAccountId },
    };
    if (!account) return { serviceAccountId: await ctx.db.insert("scoutServiceAccounts", fields) };
    const credential = await ctx.db
      .query("scoutManagedCredentials")
      .withIndex("by_service_account_id", (q) => q.eq("serviceAccountId", account._id))
      .unique();
    if (credential) await ctx.db.delete("scoutManagedCredentials", credential._id);
    await ctx.db.patch("scoutServiceAccounts", account._id, {
      ...fields,
      lastObserved: undefined,
      loginUpdatedAt: Date.now(),
    });
    return { serviceAccountId: account._id };
  },
});

function normalizedEvidenceText(value: string) {
  try {
    return decodeURIComponent(value).toLocaleLowerCase();
  } catch {
    return value.toLocaleLowerCase();
  }
}

export function serviceAccountIdentifierKey(identifier: string) {
  return normalizedEvidenceText(identifier).trim().replace(/^@+/, "");
}

function observedHttpsUrl(value: string) {
  const raw = requiredText(value, "Observed URL", MAX_OBSERVED_URL_LENGTH);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Observed URL must be an HTTPS service page without credentials");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function projectServiceAccount(account: Doc<"scoutServiceAccounts">) {
  return {
    _id: account._id,
    scoutId: account.scoutId,
    serviceName: account.serviceName,
    serviceDomain: account.serviceDomain,
    identifier: account.identifier,
    authenticationEvidence: account.authenticationEvidence,
    loginMethod: account.loginMethod,
    lastObserved: account.lastObserved ?? null,
  };
}

async function resolveObservedLoginMethod(
  ctx: Pick<MutationCtx, "db">,
  scoutId: Doc<"scouts">["_id"],
  loginMethod: typeof observedLoginMethodValidator.type,
) {
  if (loginMethod.kind === "managed_password") {
    return { kind: "managed_password" as const };
  }
  const providerServiceDomain = canonicalServiceDomain(
    loginMethod.providerServiceDomain,
    "OAuth provider service domain",
  );
  const providerIdentifier = canonicalIdentifier(loginMethod.providerIdentifier);
  const providerAccount = await ctx.db
    .query("scoutServiceAccounts")
    .withIndex("by_scout_id_and_service_domain_and_identifier", (query) =>
      query
        .eq("scoutId", scoutId)
        .eq("serviceDomain", providerServiceDomain)
        .eq("identifier", providerIdentifier),
    )
    .unique();
  if (!providerAccount) {
    throw new Error("OAuth provider account is not registered to this Scout");
  }
  return { kind: "oauth" as const, providerAccountId: providerAccount._id };
}

function loginMethodsMatch(
  stored: Doc<"scoutServiceAccounts">["loginMethod"],
  observed: Awaited<ReturnType<typeof resolveObservedLoginMethod>>,
) {
  if (stored.kind !== observed.kind) return false;
  return (
    stored.kind === "managed_password" ||
    (observed.kind === "oauth" && stored.providerAccountId === observed.providerAccountId)
  );
}

export const list = query({
  access: "access_scout_manage",
  args: {
    scoutId: v.optional(v.id("scouts")),
  },
  returns: v.array(serviceAccountPublicValidator),
  handler: async (ctx, args) => {
    const scoutId = args.scoutId;
    const accounts = scoutId
      ? await ctx.db
          .query("scoutServiceAccounts")
          .withIndex("by_scout_id", (q) => q.eq("scoutId", scoutId))
          .take(MAX_ACCOUNTS_PER_SCOUT)
      : await ctx.db.query("scoutServiceAccounts").withIndex("by_scout_id").take(MAX_ACCOUNTS);
    return accounts.map(projectServiceAccount);
  },
});

export const listRuntimeForScout = internalQuery({
  args: { scoutId: v.id("scouts") },
  returns: v.array(runtimeServiceAccountValidator),
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id", (query) => query.eq("scoutId", args.scoutId))
      .take(MAX_ACCOUNTS_PER_SCOUT);
    return accounts.map((account) => ({
      serviceAccountId: account._id,
      serviceName: account.serviceName,
      serviceDomain: account.serviceDomain,
      identifier: account.identifier,
      loginMethod: account.loginMethod,
      authenticationEvidence: account.authenticationEvidence,
    }));
  },
});

export const recordAuthenticated = internalMutation({
  args: {
    observationStartedAt: v.number(),
    sessionId: v.id("scoutBrowserSessions"),
    accountAccess: v.union(v.literal("created"), v.literal("recovered")),
    observedUrl: v.string(),
    identifier: v.string(),
    loginMethod: observedLoginMethodValidator,
  },
  returns: serviceAccountRecordingResultValidator,
  handler: async (ctx, args) => {
    const session = await ctx.db.get("scoutBrowserSessions", args.sessionId);
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
    await requireLabThread(ctx, chat.threadId);
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
      throw new Error(
        "A successful service-page observation is required before recording an account",
      );
    }
    const observedUrl = observedHttpsUrl(args.observedUrl);
    const identifier = canonicalIdentifier(args.identifier);
    const identifierKey = serviceAccountIdentifierKey(identifier);
    const activeTab = latestOperation.state.telemetry.after.tabs.find((tab) => tab.active);
    const telemetryUrl = activeTab?.url ? observedHttpsUrl(activeTab.url) : null;
    let observedDomain: string;
    try {
      observedDomain = canonicalServiceDomain(observedUrl, "Observed service URL");
    } catch {
      throw new Error("The observed service page is invalid");
    }
    if (observedUrl !== telemetryUrl) {
      throw new Error("The authenticated account evidence is not from the latest service page");
    }

    const accounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id", (query) => query.eq("scoutId", chat.scoutId))
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
    if (matchingAccounts.length > 1) {
      throw new Error("The login identifier must match exactly one Scout service account");
    }
    const loginMethod = await resolveObservedLoginMethod(ctx, chat.scoutId, args.loginMethod);
    const recordedAt = Date.now();
    const evidence = { kind: "succeeded" as const, checkedAt: recordedAt };
    const lastObserved = {
      kind: "agent_report" as const,
      operationId: latestOperation._id,
      threadId: chat.threadId,
      sessionId: session._id,
      recordedAt,
      observedUrl,
      accountAccess: args.accountAccess,
    };
    const boundAccount = matchingAccounts[0];
    if (boundAccount) {
      if (!loginMethodsMatch(boundAccount.loginMethod, loginMethod)) {
        throw new Error("Observed login method does not match the registered service account");
      }
      if (loginMethod.kind === "oauth" && loginMethod.providerAccountId === boundAccount._id) {
        throw new Error("A service account cannot authenticate through itself");
      }
      await ctx.db.patch("scoutServiceAccounts", boundAccount._id, {
        authenticationEvidence: evidence,
        lastObserved,
      });
      return { serviceAccountId: boundAccount._id, created: false };
    }

    if (loginMethod.kind === "managed_password") {
      const registeredIdentifiers = serviceAccounts
        .filter((account) => account.loginMethod.kind === "managed_password")
        .map((account) => account.identifier);
      if (registeredIdentifiers.length > 0) {
        throw new Error(
          `No saved login matches ${JSON.stringify(identifier)} on this service. Use the registered account identifier: ${registeredIdentifiers.map((identifier) => JSON.stringify(identifier)).join(", ")}.`,
        );
      }
      throw new Error("A managed-password account must be registered before it is used");
    }
    const scout = await ctx.db.get("scouts", chat.scoutId);
    if (!scout) throw new Error("Scout not found");
    const knownIdentifiers = [
      scout.agentMail.address,
      ...accounts.map((account) => account.identifier),
    ]
      .map(canonicalIdentifier)
      .filter((identifier, index, identifiers) => identifiers.indexOf(identifier) === index);
    const accountIdentifier = knownIdentifiers.find(
      (identifier) => serviceAccountIdentifierKey(identifier) === identifierKey,
    );
    if (!accountIdentifier) {
      throw new Error("The account identifier does not belong to this Scout");
    }
    if (accounts.length >= MAX_ACCOUNTS_PER_SCOUT) {
      throw new Error(`A Scout can have at most ${MAX_ACCOUNTS_PER_SCOUT} service accounts`);
    }
    const allAccounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id")
      .take(MAX_ACCOUNTS);
    if (allAccounts.length >= MAX_ACCOUNTS) {
      throw new Error(`Service account inventory can contain at most ${MAX_ACCOUNTS} accounts`);
    }
    return {
      serviceAccountId: await ctx.db.insert("scoutServiceAccounts", {
        scoutId: chat.scoutId,
        serviceName: observedDomain,
        serviceDomain: observedDomain,
        identifier: accountIdentifier,
        authenticationEvidence: evidence,
        loginMethod,
        lastObserved,
      }),
      created: true,
    };
  },
});
