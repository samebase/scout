import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, query, type MutationCtx } from "../_generated/server";
import { requireAppUser } from "../access";
import { accountObservationValidator } from "../schema";
import { canonicalServiceDomain } from "../serviceDomains";
import {
  scoutServiceAccountFieldsValidator,
  scoutServiceAccountLoginMethodValidator,
} from "./model";

const MAX_ACCOUNTS = 200;
const MAX_ACCOUNTS_PER_SCOUT = 50;
const MAX_IDENTIFIER_LENGTH = 320;
const MAX_OBSERVED_URL_LENGTH = 2_048;
const MAX_VISIBLE_EVIDENCE_LENGTH = 2_000;
const AUTHENTICATED_SESSION_CONTROLS = new Set(["sign out", "log out", "logout", "signoff"]);

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

function normalizedEvidenceText(value: string) {
  try {
    return decodeURIComponent(value).toLocaleLowerCase();
  } catch {
    return value.toLocaleLowerCase();
  }
}

function evidenceShowsIdentifier(visibleIdentity: string, identifier: string) {
  const expected = normalizedEvidenceText(identifier).trim();
  return normalizedEvidenceText(visibleIdentity)
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll(/\s+/g, " "))
    .some(
      (line) =>
        line === expected ||
        line === `@${expected}` ||
        line.endsWith(` ${expected}`) ||
        line.endsWith(` @${expected}`),
    );
}

function evidenceShowsSessionControl(visibleSessionControl: string) {
  const control = normalizedEvidenceText(visibleSessionControl).trim().replaceAll(/\s+/g, " ");
  return AUTHENTICATED_SESSION_CONTROLS.has(control);
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
  args: {
    scoutId: v.optional(v.id("scouts")),
  },
  returns: v.array(serviceAccountPublicValidator),
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
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
    }));
  },
});

export const recordAuthenticated = internalMutation({
  args: {
    sessionId: v.id("scoutBrowserSessions"),
    accountAccess: v.union(v.literal("created"), v.literal("recovered")),
    observedUrl: v.string(),
    visibleIdentity: v.string(),
    visibleSessionControl: v.string(),
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
    const visibleIdentity = requiredText(
      args.visibleIdentity,
      "Visible account identity",
      MAX_VISIBLE_EVIDENCE_LENGTH,
    );
    const visibleSessionControl = requiredText(
      args.visibleSessionControl,
      "Visible session control",
      MAX_VISIBLE_EVIDENCE_LENGTH,
    );
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
    if (!evidenceShowsSessionControl(visibleSessionControl)) {
      throw new Error("The visible account menu does not expose a Sign out or Log out control");
    }

    const accounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id", (query) => query.eq("scoutId", chat.scoutId))
      .take(MAX_ACCOUNTS_PER_SCOUT);
    const matchingAccounts = accounts.filter(
      (account) =>
        (observedDomain === account.serviceDomain ||
          observedDomain.endsWith(`.${account.serviceDomain}`)) &&
        evidenceShowsIdentifier(visibleIdentity, canonicalIdentifier(account.identifier)),
    );
    if (matchingAccounts.length > 1) {
      throw new Error("Visible account evidence must match exactly one Scout service account");
    }
    const loginMethod = await resolveObservedLoginMethod(ctx, chat.scoutId, args.loginMethod);
    const recordedAt = Date.now();
    const evidence = { kind: "succeeded" as const, checkedAt: recordedAt };
    const lastObserved = {
      threadId: chat.threadId,
      sessionId: session._id,
      recordedAt,
      observedUrl,
      visibleIdentity,
      visibleSessionControl,
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
    const accountIdentifier = knownIdentifiers.find((identifier) =>
      evidenceShowsIdentifier(visibleIdentity, identifier),
    );
    if (!accountIdentifier) {
      throw new Error("Visible account identity does not match this Scout");
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
