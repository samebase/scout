import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { vStreamDelta, vStreamMessage } from "@convex-dev/agent/validators";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";
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

const recentThreadValidator = v.object({
  threadId: v.string(),
  creationTime: v.number(),
  title: v.union(v.string(), v.null()),
});

const labMessageMetadataValidator = v.object({
  model: scoutModelValidator,
  usage: v.optional(scoutTokenUsageValidator),
  durationMs: v.optional(v.number()),
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
    return threads.page.slice(0, MAX_RECENT_THREADS).map((thread) => ({
      threadId: thread._id,
      creationTime: thread._creationTime,
      title: thread.title ?? null,
    }));
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
  args: {},
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx) => {
    const userId = await requireAppUser(ctx);
    return await scoutAgent.createThread(ctx, { userId });
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
    const prompt = promptText(args.prompt);
    const model = args.model ?? DEFAULT_SCOUT_MODEL;
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
    await ctx.db.insert("scoutLabGenerations", {
      threadId: args.threadId,
      order: message.order,
      promptMessageId: messageId,
      model,
      startedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.scout.labGeneration.generateResponse, {
      threadId: args.threadId,
      userId,
      promptMessageId: messageId,
      model,
    });
    return null;
  },
});

export const completeGeneration = internalMutation({
  args: {
    promptMessageId: v.string(),
    usage: scoutTokenUsageValidator,
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
    await ctx.db.patch(generation._id, {
      completedAt: Date.now(),
      usage: args.usage,
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
    const metadataByOrder = new Map<number, LabMessageMetadata>(
      generations.map((generation) => [
        generation.order,
        {
          model: generation.model,
          ...(generation.usage === undefined ? {} : { usage: generation.usage }),
          ...(generation.completedAt === undefined
            ? {}
            : { durationMs: Math.max(0, generation.completedAt - generation.startedAt) }),
        },
      ]),
    );
    const page = messages.page.map<Infer<typeof uiMessageValidator>>(
      ({ metadata: _metadata, ...message }) => {
        const metadata = metadataByOrder.get(message.order);
        return message.role === "assistant" && metadata ? { ...message, metadata } : message;
      },
    );
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...messages, page, streams: streams ?? { kind: "list", messages: [] } };
  },
});
