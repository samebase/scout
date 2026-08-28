import { type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import { requireAppUser } from "../access";

const MAX_SCOUTS = 50;
const MAX_RUN_LINKS = 100;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_INBOX_ID_LENGTH = 200;
const MAX_PROFILE_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 320;
const MAX_SLUG_LENGTH = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const scoutRegistrationFields = {
  displayName: v.string(),
  slug: v.string(),
  agentMail: v.object({
    inboxId: v.string(),
    address: v.string(),
  }),
  firecrawl: v.object({
    profileName: v.string(),
  }),
};

const scoutFieldsValidator = v.object({
  ...scoutRegistrationFields,
  status: v.union(v.literal("active"), v.literal("disabled")),
});

const scoutRegistrationFieldsValidator = v.object(scoutRegistrationFields);

const scoutPublicValidator = v.object({
  _id: v.id("scouts"),
  displayName: v.string(),
  slug: v.string(),
  status: v.union(v.literal("active"), v.literal("disabled")),
  agentMail: v.object({
    inboxId: v.string(),
    address: v.string(),
  }),
  firecrawl: v.object({
    profileName: v.string(),
  }),
});

const upsertResultValidator = v.object({
  scoutId: v.id("scouts"),
  created: v.boolean(),
  linkedRunCount: v.number(),
  linkLimitReached: v.boolean(),
});

const scoutConnectionValidator = v.object({
  agentMail: v.object({
    inboxId: v.string(),
  }),
  firecrawl: v.object({
    profileName: v.string(),
  }),
});

const scoutRuntimeIdentityValidator = v.object({
  displayName: v.string(),
  status: v.union(v.literal("active"), v.literal("disabled")),
  agentMail: v.object({
    inboxId: v.string(),
    address: v.string(),
  }),
  firecrawl: v.object({
    profileName: v.string(),
  }),
});

export type ScoutConnection = Infer<typeof scoutConnectionValidator>;

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

function projectScout(scout: Doc<"scouts">) {
  return {
    _id: scout._id,
    displayName: scout.displayName,
    slug: scout.slug,
    status: scout.status,
    agentMail: scout.agentMail,
    firecrawl: scout.firecrawl,
  };
}

async function saveScout(
  ctx: MutationCtx,
  args: typeof scoutFieldsValidator.type,
  options: { updateExisting: boolean },
) {
  const fields = normalizeScoutFields(args);
  const existing = await ctx.db
    .query("scouts")
    .withIndex("by_slug", (q) => q.eq("slug", fields.slug))
    .unique();
  if (existing && !options.updateExisting) {
    throw new Error("Scout slug is already registered");
  }

  const addressOwner = await ctx.db
    .query("scouts")
    .withIndex("by_agent_mail_address", (q) => q.eq("agentMail.address", fields.agentMail.address))
    .unique();
  if (addressOwner && addressOwner._id !== existing?._id) {
    throw new Error("AgentMail address is already registered to another Scout");
  }
  const inboxOwner = await ctx.db
    .query("scouts")
    .withIndex("by_agent_mail_inbox_id", (q) => q.eq("agentMail.inboxId", fields.agentMail.inboxId))
    .unique();
  if (inboxOwner && inboxOwner._id !== existing?._id) {
    throw new Error("AgentMail inbox is already registered to another Scout");
  }
  const profileOwner = await ctx.db
    .query("scouts")
    .withIndex("by_firecrawl_profile_name", (q) =>
      q.eq("firecrawl.profileName", fields.firecrawl.profileName),
    )
    .unique();
  if (profileOwner && profileOwner._id !== existing?._id) {
    throw new Error("Firecrawl profile is already registered to another Scout");
  }

  let scoutId: Id<"scouts">;
  let created: boolean;
  if (existing) {
    scoutId = existing._id;
    created = false;
    await ctx.db.patch(scoutId, fields);
  } else {
    scoutId = await ctx.db.insert("scouts", fields);
    created = true;
  }

  const matchingRuns = await ctx.db
    .query("scoutRuns")
    .withIndex("by_scout_email_and_scout_id_and_created_at", (q) =>
      q.eq("scoutEmail", fields.agentMail.address).eq("scoutId", undefined),
    )
    .order("desc")
    .take(MAX_RUN_LINKS + 1);
  const runsToLink = matchingRuns.slice(0, MAX_RUN_LINKS);

  for (const run of runsToLink) {
    await ctx.db.patch(run._id, { scoutId });
  }

  return {
    scoutId,
    created,
    linkedRunCount: runsToLink.length,
    linkLimitReached: matchingRuns.length > MAX_RUN_LINKS,
  };
}

export const list = query({
  args: {},
  returns: v.array(scoutPublicValidator),
  handler: async (ctx) => {
    await requireAppUser(ctx);
    const scouts = await ctx.db.query("scouts").order("desc").take(MAX_SCOUTS);
    return scouts.map(projectScout);
  },
});

export const get = query({
  args: {
    slug: v.string(),
  },
  returns: v.union(scoutPublicValidator, v.null()),
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    const scout = await ctx.db
      .query("scouts")
      .withIndex("by_slug", (q) => q.eq("slug", canonicalSlug(args.slug)))
      .unique();
    return scout ? projectScout(scout) : null;
  },
});

export const getConnections = internalQuery({
  args: {
    scoutId: v.id("scouts"),
  },
  returns: v.union(scoutConnectionValidator, v.null()),
  handler: async (ctx, args) => {
    const scout = await ctx.db.get(args.scoutId);
    return scout?.status === "active"
      ? {
          agentMail: {
            inboxId: scout.agentMail.inboxId,
          },
          firecrawl: {
            profileName: scout.firecrawl.profileName,
          },
        }
      : null;
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
          status: scout.status,
          agentMail: scout.agentMail,
          firecrawl: scout.firecrawl,
        }
      : null;
  },
});

export const register = mutation({
  args: scoutRegistrationFieldsValidator.fields,
  returns: upsertResultValidator,
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    return await saveScout(ctx, { ...args, status: "active" }, { updateExisting: false });
  },
});

export const upsert = internalMutation({
  args: scoutFieldsValidator.fields,
  returns: upsertResultValidator,
  handler: async (ctx, args) => await saveScout(ctx, args, { updateExisting: true }),
});
