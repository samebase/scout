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
} from "../_generated/server";
import { requireAppUser } from "../access";
import { scoutAgent } from "./agent";
import { requireOwnedAgentThread } from "./labAccess";
import {
  DEFAULT_SCOUT_MODEL,
  scoutModelValidator,
  scoutTokenUsageValidator,
  selectableScoutModelValidator,
} from "./models";

const MAX_PROMPT_LENGTH = 16_000;
const MAX_RECENT_THREADS = 50;
const MAX_THREAD_TITLE_LENGTH = 80;
const GENERATION_START_TIMEOUT_MS = 5 * 60 * 1_000;
const GENERATION_RUN_TIMEOUT_MS = 11 * 60 * 1_000;
const EXPIRED_GENERATION_FAILURE = "Generation stopped before completion";

const recentThreadValidator = v.object({
  threadId: v.string(),
  creationTime: v.number(),
  title: v.union(v.string(), v.null()),
  scoutId: v.optional(v.id("scouts")),
});

const labMessageMetadataValidator = v.object({
  model: scoutModelValidator,
  scout: v.optional(
    v.object({
      id: v.id("scouts"),
      displayName: v.string(),
    }),
  ),
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

function generationLeaseExpiresAt(generation: { startedAt: number; leaseExpiresAt?: number }) {
  return generation.leaseExpiresAt ?? generation.startedAt + GENERATION_RUN_TIMEOUT_MS;
}

async function requireActiveScout(ctx: MutationCtx, scoutId: Id<"scouts">) {
  const scout = await ctx.db.get(scoutId);
  if (!scout || scout.status !== "active") {
    throw new Error("Active Scout not found");
  }
  return scout;
}

async function bindThreadToScout(
  ctx: MutationCtx,
  args: { threadId: string; userId: Id<"users">; scoutId?: Id<"scouts"> },
) {
  const existing = await ctx.db
    .query("scoutLabThreads")
    .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
    .unique();
  if (existing) {
    if (existing.userId !== args.userId) {
      throw new Error("Thread not found");
    }
    if (args.scoutId && existing.scoutId !== args.scoutId) {
      throw new Error("A Lab thread cannot switch Scouts");
    }
    await requireActiveScout(ctx, existing.scoutId);
    return existing.scoutId;
  }
  if (!args.scoutId) {
    return undefined;
  }

  await requireActiveScout(ctx, args.scoutId);
  await ctx.db.insert("scoutLabThreads", {
    threadId: args.threadId,
    userId: args.userId,
    scoutId: args.scoutId,
    createdAt: Date.now(),
  });
  return args.scoutId;
}

export const listThreads = query({
  args: {},
  returns: v.array(recentThreadValidator),
  handler: async (ctx) => {
    const userId = await requireAppUser(ctx);
    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId,
      order: "desc",
      paginationOpts: { cursor: null, numItems: MAX_RECENT_THREADS },
    });
    const recentThreads = threads.page.slice(0, MAX_RECENT_THREADS);
    const bindings = await Promise.all(
      recentThreads.map(
        async (thread) =>
          await ctx.db
            .query("scoutLabThreads")
            .withIndex("by_thread_id", (q) => q.eq("threadId", thread._id))
            .unique(),
      ),
    );
    return recentThreads.map((thread, index) => {
      const binding = bindings[index];
      return {
        threadId: thread._id,
        creationTime: thread._creationTime,
        title: thread.title ?? null,
        ...(binding?.userId === userId ? { scoutId: binding.scoutId } : {}),
      };
    });
  },
});

export const latestThread = query({
  args: {},
  returns: v.union(v.object({ threadId: v.string() }), v.null()),
  handler: async (ctx) => {
    const userId = await requireAppUser(ctx);
    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId,
      order: "desc",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    const latest = threads.page.at(0);
    return latest ? { threadId: latest._id } : null;
  },
});

export const createThread = mutation({
  args: {
    scoutId: v.optional(v.id("scouts")),
  },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    if (args.scoutId) {
      await requireActiveScout(ctx, args.scoutId);
    }
    const created = await scoutAgent.createThread(ctx, { userId });
    if (args.scoutId) {
      await ctx.db.insert("scoutLabThreads", {
        threadId: created.threadId,
        userId,
        scoutId: args.scoutId,
        createdAt: Date.now(),
      });
    }
    return created;
  },
});

export const getThreadScoutId = internalQuery({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
  },
  returns: v.union(v.id("scouts"), v.null()),
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query("scoutLabThreads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!binding) {
      return null;
    }
    if (binding.userId !== args.userId) {
      throw new Error("Thread not found");
    }
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
    scoutId: v.optional(v.id("scouts")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const thread = await requireOwnedAgentThread(ctx, args.threadId, userId);
    const scoutId = await bindThreadToScout(ctx, {
      threadId: args.threadId,
      userId,
      ...(args.scoutId ? { scoutId: args.scoutId } : {}),
    });
    const prompt = promptText(args.prompt);
    const model = args.model ?? DEFAULT_SCOUT_MODEL;
    if (scoutId) {
      const pendingGeneration = await ctx.db
        .query("scoutLabGenerations")
        .withIndex("by_scout_id_and_status", (q) =>
          q.eq("scoutId", scoutId).eq("status", "pending"),
        )
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
      ...(scoutId ? { scoutId } : {}),
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
    const scoutIds = [
      ...new Set(
        generations.flatMap((generation) => (generation.scoutId ? [generation.scoutId] : [])),
      ),
    ];
    const scoutDocuments = await Promise.all(
      scoutIds.map(async (scoutId) => await ctx.db.get(scoutId)),
    );
    const scoutsById = new Map(
      scoutDocuments.flatMap((scout) =>
        scout ? [[scout._id, { id: scout._id, displayName: scout.displayName }] as const] : [],
      ),
    );
    const metadataByOrder = new Map<number, LabMessageMetadata>(
      generations.map((generation) => {
        const terminalAt = generation.completedAt ?? generation.failedAt;
        const scout = generation.scoutId ? scoutsById.get(generation.scoutId) : undefined;
        return [
          generation.order,
          {
            model: generation.model,
            ...(scout ? { scout } : {}),
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
          },
        ];
      }),
    );
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
