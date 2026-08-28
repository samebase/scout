import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { requireAppUser } from "../access";
import {
  scoutServiceAccountAuthenticationEvidenceValidator,
  scoutServiceAccountFieldsValidator,
} from "./model";

const MAX_ACCOUNTS = 200;
const MAX_ACCOUNTS_PER_SCOUT = 50;
const MAX_SERVICE_NAME_LENGTH = 100;
const MAX_SERVICE_DOMAIN_LENGTH = 253;
const MAX_IDENTIFIER_LENGTH = 320;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const serviceAccountPublicValidator = v.object({
  _id: v.id("scoutServiceAccounts"),
  scoutId: v.id("scouts"),
  serviceName: v.string(),
  serviceDomain: v.string(),
  identifier: v.string(),
  authenticationEvidence: scoutServiceAccountAuthenticationEvidenceValidator,
});

const serviceAccountRegistrationValidator =
  scoutServiceAccountFieldsValidator.omit("authenticationEvidence");

const serviceAccountIdResultValidator = v.object({
  serviceAccountId: v.id("scoutServiceAccounts"),
});

const authenticationOutcomeValidator = v.union(v.literal("succeeded"), v.literal("failed"));

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

function canonicalServiceDomain(value: string) {
  const input = requiredText(value, "Service domain", MAX_SERVICE_DOMAIN_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    throw new Error("Service domain must be a valid hostname or URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Service domain must use HTTP or HTTPS");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname.length > MAX_SERVICE_DOMAIN_LENGTH) {
    throw new Error("Service domain must be a valid hostname or URL");
  }
  return hostname;
}

function canonicalIdentifier(value: string) {
  const identifier = requiredText(value, "Account identifier", MAX_IDENTIFIER_LENGTH);
  return EMAIL_PATTERN.test(identifier) ? identifier.toLowerCase() : identifier;
}

function projectServiceAccount(account: Doc<"scoutServiceAccounts">) {
  return {
    _id: account._id,
    scoutId: account.scoutId,
    serviceName: account.serviceName,
    serviceDomain: account.serviceDomain,
    identifier: account.identifier,
    authenticationEvidence: account.authenticationEvidence,
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
    const serviceDomain = canonicalServiceDomain(args.serviceDomain);
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

    return {
      serviceAccountId: await ctx.db.insert("scoutServiceAccounts", {
        scoutId: args.scoutId,
        serviceName,
        serviceDomain,
        identifier,
        authenticationEvidence: { kind: "none" },
      }),
    };
  },
});

export const recordAuthentication = mutation({
  args: {
    serviceAccountId: v.id("scoutServiceAccounts"),
    outcome: authenticationOutcomeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    const account = await ctx.db.get(args.serviceAccountId);
    if (!account) {
      throw new Error("Service account not found");
    }

    const checkedAt = Date.now();
    if (args.outcome === "succeeded") {
      await ctx.db.patch(args.serviceAccountId, {
        authenticationEvidence: { kind: "succeeded", checkedAt },
      });
      return null;
    }

    const previousEvidence = account.authenticationEvidence;
    const lastSucceededAt =
      previousEvidence.kind === "succeeded"
        ? previousEvidence.checkedAt
        : previousEvidence.kind === "failed"
          ? previousEvidence.lastSucceededAt
          : undefined;
    await ctx.db.patch(args.serviceAccountId, {
      authenticationEvidence:
        lastSucceededAt === undefined
          ? { kind: "failed", checkedAt }
          : { kind: "failed", checkedAt, lastSucceededAt },
    });
    return null;
  },
});
