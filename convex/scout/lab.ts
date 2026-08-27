import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { vStreamDelta, vStreamMessage } from "@convex-dev/agent/validators";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { requireAppUser } from "../access";
import { scoutAgent } from "./agent";
import { requireOwnedAgentThread } from "./labAccess";

const MAX_PROMPT_LENGTH = 16_000;

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
  metadata: v.optional(v.any()),
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
    return await scoutAgent.createThread(ctx, {
      userId,
      title: "Scout agent lab",
    });
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    await requireOwnedAgentThread(ctx, args.threadId, userId);
    const { messageId } = await scoutAgent.saveMessage(ctx, {
      threadId: args.threadId,
      userId,
      prompt: promptText(args.prompt),
      skipEmbeddings: true,
    });
    await ctx.scheduler.runAfter(0, internal.scout.labGeneration.generateResponse, {
      threadId: args.threadId,
      userId,
      promptMessageId: messageId,
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
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...messages, streams: streams ?? { kind: "list", messages: [] } };
  },
});
