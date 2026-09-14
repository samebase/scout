import { query } from "../functions";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { requirePermission } from "../access";
import { scoutWebsiteIdentityValidator } from "./model";
import { availabilityValidator, scoutReservation } from "./availability";
import { currentActivityValidator, currentScoutActivity } from "./activity";
import type { ViewerAccess } from "../access";

const MAX_SCOUTS = 50;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_PERSON_NAME_LENGTH = 100;
const MAX_INBOX_ID_LENGTH = 200;
const MAX_PROFILE_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 320;
const MAX_SLUG_LENGTH = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const scoutFieldsValidator = v.object({
  displayName: v.string(),
  websiteIdentity: scoutWebsiteIdentityValidator,
  slug: v.string(),
  agentMail: v.object({
    inboxId: v.string(),
    address: v.string(),
  }),
  firecrawl: v.object({
    profileName: v.string(),
  }),
  status: v.union(v.literal("active"), v.literal("disabled")),
});

export const scoutRegistrationFieldsValidator = scoutFieldsValidator.omit("status");

const scoutPublicValidator = v.object({
  _id: v.id("scouts"),
  displayName: v.string(),
  websiteIdentity: scoutWebsiteIdentityValidator,
  slug: v.string(),
  status: v.union(v.literal("active"), v.literal("disabled")),
  availability: availabilityValidator,
  currentActivity: currentActivityValidator,
  agentMail: v.object({
    address: v.string(),
  }),
});

export const registrationResultValidator = v.object({
  scoutId: v.id("scouts"),
});

export type PreparedScoutRegistration = typeof scoutFieldsValidator.type;
export type ScoutRegistrationResult = typeof registrationResultValidator.type;

const scoutRuntimeIdentityValidator = v.object({
  displayName: v.string(),
  websiteIdentity: scoutWebsiteIdentityValidator,
  status: v.union(v.literal("active"), v.literal("disabled")),
  agentMail: v.object({
    inboxId: v.string(),
    address: v.string(),
  }),
  firecrawl: v.object({
    profileName: v.string(),
  }),
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

function canonicalEmail(value: string, label: string) {
  const email = requiredText(value, label, MAX_EMAIL_LENGTH).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error(`${label} must be a valid email address`);
  }
  return email;
}

function canonicalSlug(value: string) {
  const slug = requiredText(value, "Scout slug", MAX_SLUG_LENGTH).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error("Scout slug must contain only lowercase letters, numbers, and single hyphens");
  }
  return slug;
}

function normalizeScoutFields(args: typeof scoutFieldsValidator.type) {
  return {
    displayName: requiredText(args.displayName, "Scout display name", MAX_DISPLAY_NAME_LENGTH),
    websiteIdentity: {
      firstName: requiredText(
        args.websiteIdentity.firstName,
        "Scout first name",
        MAX_PERSON_NAME_LENGTH,
      ),
      lastName: requiredText(
        args.websiteIdentity.lastName,
        "Scout last name",
        MAX_PERSON_NAME_LENGTH,
      ),
    },
    slug: canonicalSlug(args.slug),
    status: args.status,
    agentMail: {
      inboxId: requiredText(args.agentMail.inboxId, "AgentMail inbox ID", MAX_INBOX_ID_LENGTH),
      address: canonicalEmail(args.agentMail.address, "AgentMail address"),
    },
    firecrawl: {
      profileName: requiredText(
        args.firecrawl.profileName,
        "Firecrawl profile name",
        MAX_PROFILE_NAME_LENGTH,
      ),
    },
  };
}

async function projectScout(ctx: QueryCtx, scout: Doc<"scouts">, viewer: ViewerAccess) {
  const reservation = await scoutReservation(ctx, scout._id);
  return {
    _id: scout._id,
    displayName: scout.displayName,
    websiteIdentity: scout.websiteIdentity,
    slug: scout.slug,
    status: scout.status,
    availability: reservation?.status ?? ("available" as const),
    currentActivity: await currentScoutActivity(ctx, scout, reservation, viewer),
    agentMail: { address: scout.agentMail.address },
  };
}

async function requireScoutAvailable(
  ctx: Pick<QueryCtx, "db">,
  fields: typeof scoutFieldsValidator.type,
) {
  const existing = await ctx.db
    .query("scouts")
    .withIndex("by_slug", (q) => q.eq("slug", fields.slug))
    .unique();
  if (existing) {
    throw new Error("Scout slug is already registered");
  }

  const addressOwner = await ctx.db
    .query("scouts")
    .withIndex("by_agent_mail_address", (q) => q.eq("agentMail.address", fields.agentMail.address))
    .unique();
  if (addressOwner) {
    throw new Error("AgentMail address is already registered to another Scout");
  }
  const inboxOwner = await ctx.db
    .query("scouts")
    .withIndex("by_agent_mail_inbox_id", (q) => q.eq("agentMail.inboxId", fields.agentMail.inboxId))
    .unique();
  if (inboxOwner) {
    throw new Error("AgentMail inbox is already registered to another Scout");
  }
  const profileOwner = await ctx.db
    .query("scouts")
    .withIndex("by_firecrawl_profile_name", (q) =>
      q.eq("firecrawl.profileName", fields.firecrawl.profileName),
    )
    .unique();
  if (profileOwner) {
    throw new Error("Firecrawl profile is already registered to another Scout");
  }
}

export const list = query({
  access: "access_scout_view",
  args: {},
  returns: v.array(scoutPublicValidator),
  handler: async (ctx) => {
    const scouts = await ctx.db.query("scouts").order("desc").take(MAX_SCOUTS);
    return await Promise.all(scouts.map((scout) => projectScout(ctx, scout, ctx.viewer)));
  },
});

export const get = query({
  access: "access_scout_view",
  args: {
    slug: v.string(),
  },
  returns: v.union(scoutPublicValidator, v.null()),
  handler: async (ctx, args) => {
    const scout = await ctx.db
      .query("scouts")
      .withIndex("by_slug", (q) => q.eq("slug", canonicalSlug(args.slug)))
      .unique();
    return scout ? projectScout(ctx, scout, ctx.viewer) : null;
  },
});

export const resources = query({
  access: "access_scout_manage",
  args: { scoutId: v.id("scouts") },
  returns: v.union(scoutFieldsValidator.pick("agentMail", "firecrawl"), v.null()),
  handler: async (ctx, args) => {
    const scout = await ctx.db.get(args.scoutId);
    return scout ? { agentMail: scout.agentMail, firecrawl: scout.firecrawl } : null;
  },
});

export const getRuntimeIdentity = internalQuery({
  args: {
    scoutId: v.id("scouts"),
  },
  returns: v.union(scoutRuntimeIdentityValidator, v.null()),
  handler: async (ctx, args) => {
    const scout = await ctx.db.get(args.scoutId);
    return scout
      ? {
          displayName: scout.displayName,
          websiteIdentity: scout.websiteIdentity,
          status: scout.status,
          agentMail: scout.agentMail,
          firecrawl: scout.firecrawl,
        }
      : null;
  },
});

export const prepareRegistration = internalQuery({
  args: scoutRegistrationFieldsValidator.fields,
  returns: scoutFieldsValidator,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "access_scout_manage");
    const fields = normalizeScoutFields({ ...args, status: "active" });
    await requireScoutAvailable(ctx, fields);
    return fields;
  },
});

export const commitRegistration = internalMutation({
  args: scoutFieldsValidator.fields,
  returns: registrationResultValidator,
  handler: async (ctx, fields) => {
    await requirePermission(ctx, "access_scout_manage");
    await requireScoutAvailable(ctx, fields);
    return { scoutId: await ctx.db.insert("scouts", fields) };
  },
});
