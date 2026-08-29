import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { requireAppUser } from "../access";
import { canonicalProductDomain, ensureProduct } from "../productsDomain";
import {
  scoutServiceAccountAuthenticationEvidenceValidator,
  scoutServiceAccountFieldsValidator,
} from "./model";

const MAX_ACCOUNTS = 200;
const MAX_ACCOUNTS_PER_SCOUT = 50;
const MAX_SERVICE_NAME_LENGTH = 100;
const MAX_IDENTIFIER_LENGTH = 320;

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
