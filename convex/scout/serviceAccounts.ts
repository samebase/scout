import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, mutation, query } from "../_generated/server";
import { requireAppUser } from "../access";
import { canonicalProductDomain, ensureProduct } from "../productsDomain";
import {
  scoutManagedCredentialMetadataValidator,
  scoutServiceAccountAuthenticationEvidenceValidator,
  scoutServiceAccountFieldsValidator,
} from "./model";

const MAX_ACCOUNTS = 200;
const MAX_ACCOUNTS_PER_SCOUT = 50;
const MAX_SERVICE_NAME_LENGTH = 100;
const MAX_IDENTIFIER_LENGTH = 320;
const MAX_OBSERVED_URL_LENGTH = 2_048;
const MAX_VISIBLE_EVIDENCE_LENGTH = 2_000;
const AUTHENTICATED_SESSION_CONTROLS = new Set(["sign out", "log out", "logout", "signoff"]);

const claimTestAccountProvenancePublicValidator = v.object({
  runId: v.id("claimTestRuns"),
  generationId: v.id("scoutLabGenerations"),
  sessionId: v.id("claimTestBrowserSessions"),
  recordedAt: v.number(),
  observedUrl: v.string(),
  visibleIdentity: v.string(),
  visibleSessionControl: v.string(),
  accountAccess: v.union(v.literal("created"), v.literal("recovered")),
});

const serviceAccountPublicValidator = v.object({
  _id: v.id("scoutServiceAccounts"),
  scoutId: v.id("scouts"),
  serviceName: v.string(),
  serviceDomain: v.string(),
  identifier: v.string(),
  authenticationEvidence: scoutServiceAccountAuthenticationEvidenceValidator,
  firstRecordedByClaimTest: v.union(claimTestAccountProvenancePublicValidator, v.null()),
  lastVerifiedByClaimTest: v.union(claimTestAccountProvenancePublicValidator, v.null()),
  managedCredential: v.optional(scoutManagedCredentialMetadataValidator),
});

const serviceAccountRegistrationValidator = scoutServiceAccountFieldsValidator
  .omit("authenticationEvidence")
  .omit("managedCredential");

const serviceAccountIdResultValidator = v.object({
  serviceAccountId: v.id("scoutServiceAccounts"),
});

const claimTestServiceAccountResultValidator = serviceAccountIdResultValidator.extend({
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
    throw new Error("Observed URL must be an HTTPS product page without credentials");
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
    firstRecordedByClaimTest: account.firstRecordedByClaimTest ?? null,
    lastVerifiedByClaimTest: account.lastVerifiedByClaimTest ?? null,
    ...(account.managedCredential ? { managedCredential: account.managedCredential } : {}),
  };
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

export const forClaimTestRun = query({
  args: { runId: v.id("claimTestRuns") },
  returns: v.union(serviceAccountPublicValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const run = await ctx.db.get("claimTestRuns", args.runId);
    if (!run || run.userId !== userId) return null;
    if (run.serviceAccountId === undefined) return null;
    const account = await ctx.db.get("scoutServiceAccounts", run.serviceAccountId);
    if (!account || account.scoutId !== run.scoutId || account.productId !== run.productId) {
      throw new Error("Claim-test run has an invalid service-account binding");
    }
    return projectServiceAccount(account);
  },
});

export const register = mutation({
  args: serviceAccountRegistrationValidator.fields,
  returns: serviceAccountIdResultValidator,
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    const scout = await ctx.db.get(args.scoutId);
    if (!scout) {
      throw new Error("Scout not found");
    }

    const serviceName = requiredText(args.serviceName, "Service name", MAX_SERVICE_NAME_LENGTH);
    const serviceDomain = canonicalProductDomain(args.serviceDomain, "Service domain");
    const identifier = canonicalIdentifier(args.identifier);
    const duplicate = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id_and_service_domain_and_identifier", (q) =>
        q
          .eq("scoutId", args.scoutId)
          .eq("serviceDomain", serviceDomain)
          .eq("identifier", identifier),
      )
      .unique();
    if (duplicate) {
      throw new Error("Service account is already registered to this Scout");
    }

    const scoutAccounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_scout_id", (q) => q.eq("scoutId", args.scoutId))
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
    const product = await ensureProduct(ctx, {
      name: serviceName,
      domain: serviceDomain,
    });

    return {
      serviceAccountId: await ctx.db.insert("scoutServiceAccounts", {
        scoutId: args.scoutId,
        productId: product.productId,
        serviceName,
        serviceDomain,
        identifier,
        authenticationEvidence: { kind: "none" },
      }),
    };
  },
});

export const upsertFromClaimTest = internalMutation({
  args: {
    promptMessageId: v.string(),
    accountAccess: v.union(v.literal("created"), v.literal("recovered")),
    observedUrl: v.string(),
    visibleIdentity: v.string(),
    visibleSessionControl: v.string(),
  },
  returns: claimTestServiceAccountResultValidator,
  handler: async (ctx, args) => {
    const generation = await ctx.db
      .query("scoutLabGenerations")
      .withIndex("by_prompt_message_id", (query) =>
        query.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!generation || generation.status !== "pending") {
      throw new Error("Active claim-test generation not found");
    }
    const run = await ctx.db
      .query("claimTestRuns")
      .withIndex("by_thread_id", (query) => query.eq("threadId", generation.threadId))
      .unique();
    if (
      !run ||
      run.state.kind !== "running" ||
      run.state.generationId !== generation._id ||
      run.scoutId !== generation.scoutId
    ) {
      throw new Error("Active claim-test run not found");
    }
    if (run.accountCreation !== "required" || run.browserProfile.kind !== "scout") {
      throw new Error("This claim-test run cannot record a created service account");
    }
    if (run.serviceAccountId === undefined) {
      throw new Error("Claim-test run has no bound managed service account");
    }
    const session = await ctx.db
      .query("claimTestBrowserSessions")
      .withIndex("by_generation_id", (query) => query.eq("generationId", generation._id))
      .unique();
    if (!session || session.runId !== run._id || session.lifecycle.kind !== "active") {
      throw new Error("Active claim-test browser session not found");
    }
    const latestOperation = await ctx.db
      .query("claimTestBrowserOperations")
      .withIndex("by_session_id_and_sequence", (query) => query.eq("sessionId", session._id))
      .order("desc")
      .first();
    if (
      !latestOperation ||
      (latestOperation.state.kind !== "applied" &&
        latestOperation.state.kind !== "applied_snapshot_failed")
    ) {
      throw new Error(
        "A successful product-page observation is required before recording an account",
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
    const product = await ctx.db.get("products", run.productId);
    if (!product || !telemetryUrl) {
      throw new Error("The observed product page is unavailable");
    }
    const boundAccount = await ctx.db.get("scoutServiceAccounts", run.serviceAccountId);
    if (
      !boundAccount ||
      boundAccount.scoutId !== run.scoutId ||
      boundAccount.productId !== product._id ||
      boundAccount.serviceDomain !== product.domain ||
      boundAccount.managedCredential === undefined
    ) {
      throw new Error("Claim-test run has an invalid service-account binding");
    }
    const expectedIdentifier = canonicalIdentifier(boundAccount.identifier);
    let observedDomain: string;
    try {
      observedDomain = canonicalProductDomain(observedUrl, "Observed product URL");
    } catch {
      throw new Error("The observed product page is invalid");
    }
    if (observedDomain !== product.domain && !observedDomain.endsWith(`.${product.domain}`)) {
      throw new Error("The observed authenticated page is not on the tested product domain");
    }
    if (observedUrl !== telemetryUrl) {
      throw new Error("The authenticated account evidence is not from the latest product page");
    }
    if (!evidenceShowsIdentifier(visibleIdentity, expectedIdentifier)) {
      throw new Error("The visible account identity does not contain the exact identifier");
    }
    if (!evidenceShowsSessionControl(visibleSessionControl)) {
      throw new Error("The visible account menu does not expose a Sign out or Log out control");
    }

    const recordedAt = Date.now();
    const evidence = { kind: "succeeded" as const, checkedAt: recordedAt };
    const provenance = {
      runId: run._id,
      generationId: generation._id,
      sessionId: session._id,
      recordedAt,
      observedUrl,
      visibleIdentity,
      visibleSessionControl,
      accountAccess: args.accountAccess,
    };
    await ctx.db.patch("scoutServiceAccounts", boundAccount._id, {
      serviceName: product.name,
      authenticationEvidence: evidence,
      firstRecordedByClaimTest: boundAccount.firstRecordedByClaimTest ?? provenance,
      lastVerifiedByClaimTest: provenance,
    });
    return { serviceAccountId: boundAccount._id, created: false };
  },
});
