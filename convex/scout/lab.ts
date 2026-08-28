import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { vStreamDelta, vStreamMessage } from "@convex-dev/agent/validators";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requireAppUser } from "../access";
import schema from "../schema";
import { scoutAgent } from "./agent";
import { requireOwnedAgentThread } from "./labAccess";
import {
  DEFAULT_SCOUT_MODEL,
  scoutModelValidator,
  scoutTokenUsageValidator,
  selectableScoutModelValidator,
} from "./models";

const MAX_PROMPT_LENGTH = 16_000;
const MAX_EXPERIMENTS_PER_USER = 100;
const MAX_EXPERIMENT_NAME_LENGTH = 120;
const MAX_TARGET_PRODUCT_LENGTH = 120;
const MAX_TARGET_DOMAIN_LENGTH = 253;
const MAX_OBJECTIVE_LENGTH = 2_000;
const MAX_ASSIGNED_THREADS = 50;
const MAX_THREAD_TITLE_LENGTH = 80;
const GENERATION_START_TIMEOUT_MS = 5 * 60 * 1_000;
const GENERATION_RUN_TIMEOUT_MS = 11 * 60 * 1_000;
const EXPIRED_GENERATION_FAILURE = "Generation stopped before completion";
const DNS_LABEL_PATTERN = /^(?!-)[a-z0-9-]+(?<!-)$/;

const experimentStatusValidator = v.union(v.literal("active"), v.literal("completed"));
const labExperimentValidator = schema.doc("scoutLabExperiments").omit("userId");

const recentThreadValidator = v.object({
  threadId: v.string(),
  creationTime: v.number(),
  title: v.union(v.string(), v.null()),
  scoutId: v.id("scouts"),
  experimentId: v.union(v.id("scoutLabExperiments"), v.null()),
});

const labMessageMetadataValidator = v.object({
  model: scoutModelValidator,
  scout: v.object({
    id: v.id("scouts"),
    displayName: v.string(),
  }),
  usage: v.optional(scoutTokenUsageValidator),
  durationMs: v.optional(v.number()),
  firecrawlCredits: v.optional(v.number()),
  firecrawlDurationMs: v.optional(v.number()),
  failure: v.optional(v.string()),
});

type LabMessageMetadata = Infer<typeof labMessageMetadataValidator>;

const uiMessageValidator = v.object({
  id: v.string(),
  _creationTime: v.number(),
  key: v.string(),
  order: v.number(),
  stepOrder: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("streaming"),
    v.literal("success"),
    v.literal("failed"),
  ),
  role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
  parts: v.array(v.any()),
  text: v.string(),
  agentName: v.optional(v.string()),
  userId: v.optional(v.string()),
  metadata: v.optional(labMessageMetadataValidator),
});

const uiMessagesResultValidator = v.object({
  ...paginationResultValidator(uiMessageValidator).fields,
  streams: v.union(
    v.object({ kind: v.literal("list"), messages: v.array(vStreamMessage) }),
    v.object({ kind: v.literal("deltas"), deltas: v.array(vStreamDelta) }),
  ),
});

function promptText(value: string) {
  const prompt = value.trim();
  if (!prompt) {
    throw new Error("Message cannot be empty");
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Message must be ${MAX_PROMPT_LENGTH} characters or fewer`);
  }
  return prompt;
}

function titleFromPrompt(prompt: string) {
  const normalized = prompt.replaceAll(/\s+/g, " ");
  const characters = Array.from(normalized);
  if (characters.length <= MAX_THREAD_TITLE_LENGTH) {
    return normalized;
  }
  return `${characters.slice(0, MAX_THREAD_TITLE_LENGTH - 1).join("")}…`;
}

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

function canonicalTargetDomain(value: string) {
  const input = requiredText(value, "Target domain", MAX_TARGET_DOMAIN_LENGTH + 8);
  let parsed: URL;
  try {
    parsed = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    throw new Error("Target domain must be a valid hostname or URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Target domain must use HTTP or HTTPS");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  const hasValidDnsLabels = labels.every(
    (label) => label.length > 0 && label.length <= 63 && DNS_LABEL_PATTERN.test(label),
  );
  if (!hostname || hostname.length > MAX_TARGET_DOMAIN_LENGTH || !hasValidDnsLabels) {
    throw new Error("Target domain must be a valid hostname or URL");
  }
  return hostname;
}

function generationLeaseExpiresAt(generation: { leaseExpiresAt: number }) {
  return generation.leaseExpiresAt;
}

async function requireActiveScout(ctx: MutationCtx, scoutId: Id<"scouts">) {
  const scout = await requireScout(ctx, scoutId);
  if (scout.status !== "active") {
    throw new Error("Active Scout not found");
  }
  return scout;
}

async function requireScout(ctx: MutationCtx, scoutId: Id<"scouts">) {
  const scout = await ctx.db.get(scoutId);
  if (!scout) {
    throw new Error("Scout not found");
  }
  return scout;
}

async function requireOwnedExperiment(
  ctx: Pick<QueryCtx, "db">,
  args: { experimentId: Id<"scoutLabExperiments">; userId: Id<"users"> },
) {
  const experiment = await ctx.db.get(args.experimentId);
  if (!experiment || experiment.userId !== args.userId) {
    throw new Error("Experiment not found");
  }
  return experiment;
}

async function requireThreadBinding(
  ctx: Pick<QueryCtx, "db">,
  args: { threadId: string; userId: Id<"users"> },
) {
  const binding = await ctx.db
    .query("scoutLabThreads")
    .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
    .unique();
  if (!binding || binding.userId !== args.userId) {
    throw new Error("Thread is missing its Scout binding");
  }
  return binding;
}

export const listThreads = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(recentThreadValidator),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId,
      order: "desc",
      paginationOpts: args.paginationOpts,
    });
    const bindings = await Promise.all(
      threads.page.map(
        async (thread) => await requireThreadBinding(ctx, { threadId: thread._id, userId }),
      ),
    );
    return {
      ...threads,
      page: threads.page.map((thread, index) => {
        const binding = bindings[index];
        if (!binding) {
          throw new Error("Thread is missing its Scout binding");
        }
        return {
          threadId: thread._id,
          creationTime: thread._creationTime,
          title: thread.title ?? null,
          scoutId: binding.scoutId,
          experimentId: binding.experimentId ?? null,
        };
      }),
    };
  },
});

export const listExperiments = query({
  args: {},
  returns: v.array(labExperimentValidator),
  handler: async (ctx) => {
    const userId = await requireAppUser(ctx);
    const experiments = await ctx.db
      .query("scoutLabExperiments")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_EXPERIMENTS_PER_USER);
    return experiments.map(({ userId: _userId, ...experiment }) => experiment);
  },
});

export const createExperiment = mutation({
  args: {
    name: v.string(),
    scoutId: v.id("scouts"),
    targetProduct: v.string(),
    targetDomain: v.string(),
    objective: v.string(),
  },
  returns: v.object({ experimentId: v.id("scoutLabExperiments") }),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    await requireScout(ctx, args.scoutId);
    const experiments = await ctx.db
      .query("scoutLabExperiments")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .take(MAX_EXPERIMENTS_PER_USER);
    if (experiments.length >= MAX_EXPERIMENTS_PER_USER) {
      throw new Error(`The Lab can contain at most ${MAX_EXPERIMENTS_PER_USER} experiments`);
    }
    return {
      experimentId: await ctx.db.insert("scoutLabExperiments", {
        userId,
        scoutId: args.scoutId,
        name: requiredText(args.name, "Experiment name", MAX_EXPERIMENT_NAME_LENGTH),
        targetProduct: requiredText(
          args.targetProduct,
          "Target product",
          MAX_TARGET_PRODUCT_LENGTH,
        ),
        targetDomain: canonicalTargetDomain(args.targetDomain),
        objective: requiredText(args.objective, "Objective", MAX_OBJECTIVE_LENGTH),
        status: "active",
      }),
    };
  },
});

export const setExperimentStatus = mutation({
  args: {
    experimentId: v.id("scoutLabExperiments"),
    status: experimentStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const experiment = await requireOwnedExperiment(ctx, {
      experimentId: args.experimentId,
      userId,
    });
    if (args.status === "active") {
      await requireActiveScout(ctx, experiment.scoutId);
    }
    await ctx.db.patch(experiment._id, { status: args.status });
    return null;
  },
});

export const assignThreads = mutation({
  args: {
    experimentId: v.id("scoutLabExperiments"),
    threadIds: v.array(v.string()),
  },
  returns: v.object({ assigned: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const experiment = await requireOwnedExperiment(ctx, {
      experimentId: args.experimentId,
      userId,
    });
    const threadIds = [...new Set(args.threadIds)];
    if (threadIds.length === 0) {
      throw new Error("Select at least one thread");
    }
    if (threadIds.length > MAX_ASSIGNED_THREADS) {
      throw new Error(`Assign at most ${MAX_ASSIGNED_THREADS} threads at a time`);
    }

    const bindings = await Promise.all(
      threadIds.map(async (threadId) => await requireThreadBinding(ctx, { threadId, userId })),
    );
    for (const binding of bindings) {
      if (binding.scoutId !== experiment.scoutId) {
        throw new Error("Thread and experiment must use the same Scout");
      }
      if (binding.experimentId && binding.experimentId !== experiment._id) {
        throw new Error("Thread already belongs to another experiment");
      }
    }

    const unassigned = bindings.filter((binding) => binding.experimentId === undefined);
    await Promise.all(
      unassigned.map(
        async (binding) => await ctx.db.patch(binding._id, { experimentId: experiment._id }),
      ),
    );
    return { assigned: unassigned.length };
  },
});

export const createThread = mutation({
  args: {
    experimentId: v.id("scoutLabExperiments"),
  },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const experiment = await requireOwnedExperiment(ctx, {
      experimentId: args.experimentId,
      userId,
    });
    if (experiment.status !== "active") {
      throw new Error("Experiment is completed");
    }
    await requireActiveScout(ctx, experiment.scoutId);
    const created = await scoutAgent.createThread(ctx, { userId });
    await ctx.db.insert("scoutLabThreads", {
      threadId: created.threadId,
      userId,
      scoutId: experiment.scoutId,
      experimentId: experiment._id,
      createdAt: Date.now(),
    });
    return created;
  },
});

export const getThreadScoutId = internalQuery({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
  },
  returns: v.id("scouts"),
  handler: async (ctx, args) => {
    const binding = await requireThreadBinding(ctx, args);
    return binding.scoutId;
  },
});

export const getScoutActivity = query({
  args: {
    scoutId: v.id("scouts"),
  },
  returns: v.object({ active: v.boolean() }),
  handler: async (ctx, args) => {
    await requireAppUser(ctx);
    const generation = await ctx.db
      .query("scoutLabGenerations")
      .withIndex("by_scout_id_and_status", (q) =>
        q.eq("scoutId", args.scoutId).eq("status", "pending"),
      )
      .first();
    return {
      active: generation !== null && generationLeaseExpiresAt(generation) > Date.now(),
    };
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    model: v.optional(selectableScoutModelValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const thread = await requireOwnedAgentThread(ctx, args.threadId, userId);
    const { scoutId } = await requireThreadBinding(ctx, { threadId: args.threadId, userId });
    await requireActiveScout(ctx, scoutId);
    const prompt = promptText(args.prompt);
    const model = args.model ?? DEFAULT_SCOUT_MODEL;
    const pendingGeneration = await ctx.db
      .query("scoutLabGenerations")
      .withIndex("by_scout_id_and_status", (q) => q.eq("scoutId", scoutId).eq("status", "pending"))
      .first();
    if (pendingGeneration) {
      if (generationLeaseExpiresAt(pendingGeneration) > Date.now()) {
        throw new Error("Scout is already working");
      }
      await ctx.db.patch(pendingGeneration._id, {
        status: "failed",
        failedAt: Date.now(),
        failure: EXPIRED_GENERATION_FAILURE,
      });
    }
    if (!thread.title) {
      await scoutAgent.updateThreadMetadata(ctx, {
        threadId: args.threadId,
        patch: { title: titleFromPrompt(prompt) },
      });
    }
    const { messageId, message } = await scoutAgent.saveMessage(ctx, {
      threadId: args.threadId,
      userId,
      prompt,
      skipEmbeddings: true,
    });
    const leaseExpiresAt = Date.now() + GENERATION_START_TIMEOUT_MS;
    const generationId = await ctx.db.insert("scoutLabGenerations", {
      threadId: args.threadId,
      order: message.order,
      promptMessageId: messageId,
      scoutId,
      status: "pending",
      leaseExpiresAt,
      model,
      startedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.scout.labGeneration.generateResponse, {
      threadId: args.threadId,
      userId,
      promptMessageId: messageId,
      model,
    });
    await ctx.scheduler.runAt(leaseExpiresAt, internal.scout.lab.expireGeneration, {
      generationId,
    });
    return null;
  },
});

export const startGeneration = internalMutation({
  args: {
    promptMessageId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const generation = await ctx.db
      .query("scoutLabGenerations")
      .withIndex("by_prompt_message_id", (q) => q.eq("promptMessageId", args.promptMessageId))
      .unique();
    if (!generation || generation.status !== "pending") {
      return false;
    }
    if (generationLeaseExpiresAt(generation) <= Date.now()) {
      await ctx.db.patch(generation._id, {
        status: "failed",
        failedAt: Date.now(),
        failure: EXPIRED_GENERATION_FAILURE,
      });
      return false;
    }

    const leaseExpiresAt = Date.now() + GENERATION_RUN_TIMEOUT_MS;
    await ctx.db.patch(generation._id, { leaseExpiresAt });
    await ctx.scheduler.runAt(leaseExpiresAt, internal.scout.lab.expireGeneration, {
      generationId: generation._id,
    });
    return true;
  },
});

export const expireGeneration = internalMutation({
  args: {
    generationId: v.id("scoutLabGenerations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      generation.status !== "pending" ||
      generationLeaseExpiresAt(generation) > Date.now()
    ) {
      return null;
    }
    await ctx.db.patch(generation._id, {
      status: "failed",
      failedAt: Date.now(),
      failure: EXPIRED_GENERATION_FAILURE,
    });
    return null;
  },
});

export const completeGeneration = internalMutation({
  args: {
    promptMessageId: v.string(),
    usage: scoutTokenUsageValidator,
    firecrawlCredits: v.optional(v.number()),
    firecrawlDurationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db
      .query("scoutLabGenerations")
      .withIndex("by_prompt_message_id", (q) => q.eq("promptMessageId", args.promptMessageId))
      .unique();
    if (!generation) {
      throw new Error("Lab generation not found");
    }
    if (generation.status === "completed" || generation.status === "failed") {
      return null;
    }
    await ctx.db.patch(generation._id, {
      status: "completed",
      completedAt: Date.now(),
      usage: args.usage,
      ...(args.firecrawlCredits === undefined ? {} : { firecrawlCredits: args.firecrawlCredits }),
      ...(args.firecrawlDurationMs === undefined
        ? {}
        : { firecrawlDurationMs: args.firecrawlDurationMs }),
    });
    return null;
  },
});

export const failGeneration = internalMutation({
  args: {
    promptMessageId: v.string(),
    failure: v.string(),
    usage: v.optional(scoutTokenUsageValidator),
    firecrawlCredits: v.optional(v.number()),
    firecrawlDurationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db
      .query("scoutLabGenerations")
      .withIndex("by_prompt_message_id", (q) => q.eq("promptMessageId", args.promptMessageId))
      .unique();
    if (!generation) {
      throw new Error("Lab generation not found");
    }
    if (generation.status === "completed" || generation.status === "failed") {
      return null;
    }
    await ctx.db.patch(generation._id, {
      status: "failed",
      failedAt: Date.now(),
      failure: args.failure,
      ...(args.usage === undefined ? {} : { usage: args.usage }),
      ...(args.firecrawlCredits === undefined ? {} : { firecrawlCredits: args.firecrawlCredits }),
      ...(args.firecrawlDurationMs === undefined
        ? {}
        : { firecrawlDurationMs: args.firecrawlDurationMs }),
    });
    return null;
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  returns: uiMessagesResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    await requireOwnedAgentThread(ctx, args.threadId, userId);
    await requireThreadBinding(ctx, { threadId: args.threadId, userId });
    const messages = await listUIMessages(ctx, components.agent, args);
    const orders = messages.page.map((message) => message.order);
    const firstOrder = orders.length > 0 ? Math.min(...orders) : undefined;
    const lastOrder = orders.length > 0 ? Math.max(...orders) : undefined;
    const generations =
      firstOrder === undefined || lastOrder === undefined
        ? []
        : await ctx.db
            .query("scoutLabGenerations")
            .withIndex("by_thread_id_and_order", (q) =>
              q.eq("threadId", args.threadId).gte("order", firstOrder).lte("order", lastOrder),
            )
            .collect();
    const scoutIds = [...new Set(generations.map((generation) => generation.scoutId))];
    const scoutsById = new Map<Id<"scouts">, { id: Id<"scouts">; displayName: string }>();
    for (const scoutId of scoutIds) {
      const scout = await ctx.db.get(scoutId);
      if (!scout) {
        throw new Error("Scout not found");
      }
      scoutsById.set(scout._id, { id: scout._id, displayName: scout.displayName });
    }
    const metadataByOrder = new Map<number, LabMessageMetadata>();
    for (const generation of generations) {
      const terminalAt = generation.completedAt ?? generation.failedAt;
      const scout = scoutsById.get(generation.scoutId);
      if (!scout) {
        throw new Error("Scout not found");
      }
      metadataByOrder.set(generation.order, {
        model: generation.model,
        scout,
        ...(generation.usage === undefined ? {} : { usage: generation.usage }),
        ...(terminalAt === undefined
          ? {}
          : { durationMs: Math.max(0, terminalAt - generation.startedAt) }),
        ...(generation.firecrawlCredits === undefined
          ? {}
          : { firecrawlCredits: generation.firecrawlCredits }),
        ...(generation.firecrawlDurationMs === undefined
          ? {}
          : { firecrawlDurationMs: generation.firecrawlDurationMs }),
        ...(generation.failure === undefined ? {} : { failure: generation.failure }),
      });
    }
    const assistantOrders = new Set(
      messages.page
        .filter((message) => message.role === "assistant")
        .map((message) => message.order),
    );
    const page = messages.page.map<Infer<typeof uiMessageValidator>>(
      ({ metadata: _metadata, ...message }) => {
        const metadata = metadataByOrder.get(message.order);
        if (!metadata) {
          return message;
        }
        if (
          message.role === "assistant" ||
          (message.role === "user" && metadata.failure && !assistantOrders.has(message.order))
        ) {
          return { ...message, metadata };
        }
        return message;
      },
    );
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...messages, page, streams: streams ?? { kind: "list", messages: [] } };
  },
});
