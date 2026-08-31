import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { vStreamDelta, vStreamMessage } from "@convex-dev/agent/validators";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requireAppUser } from "../access";
import { canonicalProductDomain, ensureProduct } from "../productsDomain";
import schema from "../schema";
import { scoutAgent } from "./agent";
import { requireOwnedAgentThread } from "./labAccess";
import {
  DEFAULT_SCOUT_MODEL,
  scoutModelValidator,
  scoutTokenUsageValidator,
  selectableScoutModelValidator,
} from "./models";
import { EXPIRED_TURN_FAILURE, TURN_START_TIMEOUT_MS } from "./turns";

const MAX_PROMPT_LENGTH = 16_000;
const MAX_EXPERIMENTS_PER_USER = 100;
const MAX_EXPERIMENT_NAME_LENGTH = 120;
const MAX_TARGET_PRODUCT_LENGTH = 120;
const MAX_OBJECTIVE_LENGTH = 2_000;
const MAX_ASSIGNED_THREADS = 50;
const MAX_THREAD_TITLE_LENGTH = 80;

const experimentStatusValidator = v.union(v.literal("active"), v.literal("completed"));
const labExperimentValidator = schema.doc("scoutLabExperiments").omit("userId").omit("productId");

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
    const bindings = await ctx.db
      .query("scoutLabThreads")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      bindings.page.map(async (binding) => {
        const thread = await requireOwnedAgentThread(ctx, binding.threadId, binding.userId);
        return {
          threadId: thread._id,
          creationTime: thread._creationTime,
          title: thread.title ?? null,
          scoutId: binding.scoutId,
          experimentId: binding.experimentId ?? null,
        };
      }),
    );
    return {
      ...bindings,
      page,
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
    return experiments.map(
      ({ userId: _userId, productId: _productId, ...experiment }) => experiment,
    );
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
    const name = requiredText(args.name, "Experiment name", MAX_EXPERIMENT_NAME_LENGTH);
    const targetProduct = requiredText(
      args.targetProduct,
      "Target product",
      MAX_TARGET_PRODUCT_LENGTH,
    );
    const targetDomain = canonicalProductDomain(args.targetDomain, "Target domain");
    const product = await ensureProduct(ctx, {
      name: targetProduct,
      domain: targetDomain,
    });
    return {
      experimentId: await ctx.db.insert("scoutLabExperiments", {
        userId,
        scoutId: args.scoutId,
        name,
        targetProduct,
        targetDomain,
        productId: product.productId,
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
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_scout_id_and_state_kind", (q) =>
        q.eq("scoutId", args.scoutId).eq("state.kind", "pending"),
      )
      .first();
    return {
      active:
        turn !== null && turn.state.kind === "pending" && turn.state.leaseExpiresAt > Date.now(),
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
    const pendingTurn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_scout_id_and_state_kind", (q) =>
        q.eq("scoutId", scoutId).eq("state.kind", "pending"),
      )
      .first();
    if (pendingTurn) {
      if (pendingTurn.state.kind === "pending" && pendingTurn.state.leaseExpiresAt > Date.now()) {
        throw new Error("Scout is already working");
      }
      await ctx.db.patch(pendingTurn._id, {
        state: {
          kind: "failed",
          failedAt: Date.now(),
          failure: EXPIRED_TURN_FAILURE,
        },
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
    const leaseExpiresAt = Date.now() + TURN_START_TIMEOUT_MS;
    const turnId = await ctx.db.insert("scoutTurns", {
      threadId: args.threadId,
      order: message.order,
      promptMessageId: messageId,
      scoutId,
      model,
      startedAt: Date.now(),
      state: { kind: "pending", leaseExpiresAt },
    });
    await ctx.scheduler.runAfter(0, internal.scout.labGeneration.generateResponse, {
      threadId: args.threadId,
      userId,
      promptMessageId: messageId,
      model,
    });
    await ctx.scheduler.runAt(leaseExpiresAt, internal.scout.turns.expire, { turnId });
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
    const turns =
      firstOrder === undefined || lastOrder === undefined
        ? []
        : await ctx.db
            .query("scoutTurns")
            .withIndex("by_thread_id_and_order", (q) =>
              q.eq("threadId", args.threadId).gte("order", firstOrder).lte("order", lastOrder),
            )
            .collect();
    const scoutIds = [...new Set(turns.map((turn) => turn.scoutId))];
    const scoutsById = new Map<Id<"scouts">, { id: Id<"scouts">; displayName: string }>();
    for (const scoutId of scoutIds) {
      const scout = await ctx.db.get(scoutId);
      if (!scout) {
        throw new Error("Scout not found");
      }
      scoutsById.set(scout._id, { id: scout._id, displayName: scout.displayName });
    }
    const metadataByOrder = new Map<number, LabMessageMetadata>();
    for (const turn of turns) {
      const terminalAt =
        turn.state.kind === "completed"
          ? turn.state.completedAt
          : turn.state.kind === "failed"
            ? turn.state.failedAt
            : undefined;
      const scout = scoutsById.get(turn.scoutId);
      if (!scout) {
        throw new Error("Scout not found");
      }
      metadataByOrder.set(turn.order, {
        model: turn.model,
        scout,
        ...(turn.state.kind === "completed" || turn.state.kind === "failed"
          ? turn.state.usage === undefined
            ? {}
            : { usage: turn.state.usage }
          : {}),
        ...(terminalAt === undefined
          ? {}
          : { durationMs: Math.max(0, terminalAt - turn.startedAt) }),
        ...(turn.state.kind === "completed" || turn.state.kind === "failed"
          ? turn.state.firecrawlCredits === undefined
            ? {}
            : { firecrawlCredits: turn.state.firecrawlCredits }
          : {}),
        ...(turn.state.kind === "completed" || turn.state.kind === "failed"
          ? turn.state.firecrawlDurationMs === undefined
            ? {}
            : { firecrawlDurationMs: turn.state.firecrawlDurationMs }
          : {}),
        ...(turn.state.kind === "failed" ? { failure: turn.state.failure } : {}),
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
