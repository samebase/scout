import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { vStreamDelta, vStreamMessage } from "@convex-dev/agent/validators";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireAppUser } from "./access";
import {
  taskBrowserActionValidator,
  taskBrowserOperationValidator,
  taskBrowserOutcomeValidator,
  taskBrowserSessionLifecycleValidator,
  taskBrowserViewportValidator,
} from "./taskBrowserModel";
import {
  taskBrowserProfileSelectionValidator,
  taskBrowserProfileValidator,
} from "./taskAttemptModel";
import {
  taskAttemptSummaryValidator,
  taskBrowserSessionDetailValidator,
  taskBrowserSessionSummaryValidator,
  taskDetailValidator,
  taskSummaryValidator,
  taskTurnValidator,
} from "./tasksModel";
import { canonicalProductDomain } from "./productsDomain";
import { scoutAgent } from "./scout/agent";
import { requireOwnedAgentThread } from "./scout/labAccess";
import { requireFirecrawlLiveViewUrl } from "./scout/lib/firecrawlLiveView";
import {
  DEFAULT_SCOUT_MODEL,
  scoutModelValidator,
  scoutTokenUsageValidator,
  type SelectableScoutModel,
} from "./scout/models";
import { EXPIRED_TURN_FAILURE, TURN_START_TIMEOUT_MS } from "./scout/turns";

const MAX_TASKS_PER_PRODUCT = 100;
const MAX_ATTEMPTS_PER_TASK = 50;
const MAX_TURNS_PER_ATTEMPT = 50;
const MAX_TASK_INSTRUCTION_LENGTH = 16_000;
const MAX_THREAD_TITLE_LENGTH = 80;
const MAX_BROWSER_SESSION_ID_LENGTH = 200;
const MAX_BROWSER_TOOL_CALL_ID_LENGTH = 200;
const MAX_BROWSER_FAILURE_LENGTH = 2_000;
const MAX_BROWSER_OPERATIONS = 100;
const MAX_BROWSER_SESSIONS_PER_ATTEMPT = 50;
const MAX_ATTEMPT_CONCLUSION_LENGTH = 500;
const TASK_BROWSER_VIEWPORT = { width: 1_280, height: 800 } as const;
const TASK_MODEL = DEFAULT_SCOUT_MODEL satisfies SelectableScoutModel;

type DatabaseContext = Pick<QueryCtx, "db">;

const messageMetadataValidator = v.object({
  model: scoutModelValidator,
  scout: v.object({ id: v.id("scouts"), displayName: v.string() }),
  usage: v.optional(scoutTokenUsageValidator),
  durationMs: v.optional(v.number()),
  firecrawlCredits: v.optional(v.number()),
  firecrawlDurationMs: v.optional(v.number()),
  failure: v.optional(v.string()),
});

type MessageMetadata = Infer<typeof messageMetadataValidator>;

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
  metadata: v.optional(messageMetadataValidator),
});

const uiMessagesResultValidator = v.object({
  ...paginationResultValidator(uiMessageValidator).fields,
  streams: v.union(
    v.object({ kind: v.literal("list"), messages: v.array(vStreamMessage) }),
    v.object({ kind: v.literal("deltas"), deltas: v.array(vStreamDelta) }),
  ),
});

function requiredInstruction(value: string) {
  const instruction = value.trim();
  if (!instruction) throw new Error("Task instruction cannot be empty");
  if (Array.from(instruction).length > MAX_TASK_INSTRUCTION_LENGTH) {
    throw new Error(`Task instruction must be ${MAX_TASK_INSTRUCTION_LENGTH} characters or fewer`);
  }
  return instruction;
}

function titleFromInstruction(instruction: string) {
  const normalized = instruction.replaceAll(/\s+/g, " ");
  const characters = Array.from(normalized);
  return characters.length <= MAX_THREAD_TITLE_LENGTH
    ? normalized
    : `${characters.slice(0, MAX_THREAD_TITLE_LENGTH - 1).join("")}…`;
}

function truncateText(value: string, maximumLength: number) {
  const characters = Array.from(value.trim().replaceAll(/\s+/g, " "));
  return characters.length <= maximumLength
    ? characters.join("")
    : `${characters.slice(0, maximumLength - 1).join("")}…`;
}

function requiredConclusion(value: string) {
  const conclusion = value.trim().replaceAll(/\s+/g, " ");
  if (!conclusion) throw new Error("Attempt conclusion cannot be empty");
  if (Array.from(conclusion).length > MAX_ATTEMPT_CONCLUSION_LENGTH) {
    throw new Error(
      `Attempt conclusion must be ${MAX_ATTEMPT_CONCLUSION_LENGTH} characters or fewer`,
    );
  }
  return conclusion;
}

async function requireOwnedTask(
  ctx: DatabaseContext,
  args: { taskId: Id<"productTasks">; userId: Id<"users"> },
) {
  const task = await ctx.db.get("productTasks", args.taskId);
  if (!task || task.userId !== args.userId) throw new Error("Task not found");
  return task;
}

async function requireOwnedAttempt(
  ctx: DatabaseContext,
  args: { attemptId: Id<"taskAttempts">; userId: Id<"users"> },
) {
  const attempt = await ctx.db.get("taskAttempts", args.attemptId);
  if (!attempt) throw new Error("Attempt not found");
  const task = await requireOwnedTask(ctx, { taskId: attempt.taskId, userId: args.userId });
  return { attempt, task };
}

async function requireAvailableScout(ctx: MutationCtx, scoutId: Id<"scouts">, now: number) {
  const scout = await ctx.db.get("scouts", scoutId);
  if (!scout || scout.status !== "active") throw new Error("Selected Scout is not active");
  const pending = await ctx.db
    .query("scoutTurns")
    .withIndex("by_scout_id_and_state_kind", (index) =>
      index.eq("scoutId", scout._id).eq("state.kind", "pending"),
    )
    .first();
  if (!pending) return scout;
  if (pending.state.kind !== "pending") throw new Error("Scout turn state is invalid");
  if (pending.state.leaseExpiresAt > now) throw new Error("Scout is already working");
  await ctx.db.patch("scoutTurns", pending._id, {
    state: { kind: "failed", failedAt: now, failure: EXPIRED_TURN_FAILURE },
  });
  return scout;
}

async function enqueueTurn(
  ctx: MutationCtx,
  args: {
    threadId: string;
    userId: Id<"users">;
    scoutId: Id<"scouts">;
    prompt: string;
  },
) {
  const prompt = requiredInstruction(args.prompt);
  const now = Date.now();
  await requireAvailableScout(ctx, args.scoutId, now);
  const saved = await scoutAgent.saveMessage(ctx, {
    threadId: args.threadId,
    userId: args.userId,
    prompt,
    skipEmbeddings: true,
  });
  const leaseExpiresAt = now + TURN_START_TIMEOUT_MS;
  const turnId = await ctx.db.insert("scoutTurns", {
    threadId: args.threadId,
    order: saved.message.order,
    promptMessageId: saved.messageId,
    scoutId: args.scoutId,
    model: TASK_MODEL,
    startedAt: now,
    state: { kind: "pending", leaseExpiresAt },
  });
  await ctx.scheduler.runAfter(0, internal.scout.labGeneration.generateResponse, {
    threadId: args.threadId,
    userId: args.userId,
    promptMessageId: saved.messageId,
    model: TASK_MODEL,
  });
  await ctx.scheduler.runAt(leaseExpiresAt, internal.scout.turns.expire, { turnId });
  return turnId;
}

async function projectAttempt(ctx: DatabaseContext, attempt: Doc<"taskAttempts">) {
  const [scout, turns, sessions] = await Promise.all([
    ctx.db.get("scouts", attempt.scoutId),
    ctx.db
      .query("scoutTurns")
      .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", attempt.threadId))
      .order("asc")
      .take(MAX_TURNS_PER_ATTEMPT),
    ctx.db
      .query("taskBrowserSessions")
      .withIndex("by_attempt_id_and_sequence", (index) => index.eq("attemptId", attempt._id))
      .take(MAX_BROWSER_SESSIONS_PER_ATTEMPT),
  ]);
  if (!scout || turns.length === 0) throw new Error("Attempt context is unavailable");
  return {
    attemptId: attempt._id,
    createdAt: attempt._creationTime,
    threadId: attempt.threadId,
    browserProfile: attempt.browserProfile,
    scout: { id: scout._id, displayName: scout.displayName },
    state: attempt.state,
    latestTurnState: turns.at(-1)!.state,
    turnCount: turns.length,
    browserSessionCount: sessions.length,
  };
}

export const listForProduct = query({
  args: { domain: v.string() },
  returns: v.array(taskSummaryValidator),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    let domain: string;
    try {
      domain = canonicalProductDomain(args.domain, "Product domain");
    } catch {
      return [];
    }
    const product = await ctx.db
      .query("products")
      .withIndex("by_domain", (index) => index.eq("domain", domain))
      .unique();
    if (!product) return [];
    const tasks = await ctx.db
      .query("productTasks")
      .withIndex("by_user_id_and_product_id", (index) =>
        index.eq("userId", userId).eq("productId", product._id),
      )
      .order("desc")
      .take(MAX_TASKS_PER_PRODUCT);
    return await Promise.all(
      tasks.map(async (task) => {
        const attempts = await ctx.db
          .query("taskAttempts")
          .withIndex("by_task_id", (index) => index.eq("taskId", task._id))
          .order("desc")
          .take(MAX_ATTEMPTS_PER_TASK);
        const latest = attempts[0];
        const latestAttempt = latest ? await projectAttempt(ctx, latest) : null;
        return {
          taskId: task._id,
          instruction: task.instruction,
          createdAt: task._creationTime,
          attemptCount: attempts.length,
          latestAttempt:
            latestAttempt === null
              ? null
              : {
                  attemptId: latestAttempt.attemptId,
                  createdAt: latestAttempt.createdAt,
                  scoutName: latestAttempt.scout.displayName,
                  state: latestAttempt.state,
                  latestTurnState: latestAttempt.latestTurnState,
                },
        };
      }),
    );
  },
});

export const get = query({
  args: { taskId: v.id("productTasks") },
  returns: v.union(taskDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const task = await ctx.db.get("productTasks", args.taskId);
    if (!task || task.userId !== userId) return null;
    const product = await ctx.db.get("products", task.productId);
    if (!product) throw new Error("Task product is unavailable");
    return {
      taskId: task._id,
      instruction: task.instruction,
      createdAt: task._creationTime,
      product: {
        name: product.name,
        domain: product.domain,
        primaryUrl: product.primaryUrl,
      },
    };
  },
});

export const create = mutation({
  args: { productId: v.id("products"), instruction: v.string() },
  returns: v.object({ taskId: v.id("productTasks") }),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const product = await ctx.db.get("products", args.productId);
    if (!product) throw new Error("Product not found");
    const tasks = await ctx.db
      .query("productTasks")
      .withIndex("by_user_id_and_product_id", (index) =>
        index.eq("userId", userId).eq("productId", product._id),
      )
      .take(MAX_TASKS_PER_PRODUCT);
    if (tasks.length >= MAX_TASKS_PER_PRODUCT) {
      throw new Error(`A product can have at most ${MAX_TASKS_PER_PRODUCT} tasks`);
    }
    return {
      taskId: await ctx.db.insert("productTasks", {
        userId,
        productId: product._id,
        instruction: requiredInstruction(args.instruction),
      }),
    };
  },
});

export const update = mutation({
  args: { taskId: v.id("productTasks"), instruction: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const task = await requireOwnedTask(ctx, { taskId: args.taskId, userId });
    await ctx.db.patch("productTasks", task._id, {
      instruction: requiredInstruction(args.instruction),
    });
    return null;
  },
});

export const remove = mutation({
  args: { taskId: v.id("productTasks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const task = await requireOwnedTask(ctx, { taskId: args.taskId, userId });
    const serviceAccounts = await ctx.db
      .query("scoutServiceAccounts")
      .withIndex("by_product_id", (index) => index.eq("productId", task.productId))
      .take(200);
    for (const account of serviceAccounts) {
      if (
        account.firstRecordedByTask?.taskId !== task._id &&
        account.lastVerifiedByTask?.taskId !== task._id
      ) {
        continue;
      }
      await ctx.db.patch("scoutServiceAccounts", account._id, {
        ...(account.firstRecordedByTask?.taskId === task._id
          ? { firstRecordedByTask: undefined }
          : {}),
        ...(account.lastVerifiedByTask?.taskId === task._id
          ? { lastVerifiedByTask: undefined }
          : {}),
      });
    }
    const attempts = await ctx.db
      .query("taskAttempts")
      .withIndex("by_task_id", (index) => index.eq("taskId", task._id))
      .take(MAX_ATTEMPTS_PER_TASK);
    for (const attempt of attempts) {
      const turns = await ctx.db
        .query("scoutTurns")
        .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", attempt.threadId))
        .take(MAX_TURNS_PER_ATTEMPT);
      if (turns.some((turn) => turn.state.kind === "pending")) {
        throw new Error("Wait for the active attempt to finish before deleting this task");
      }
      const sessions = await ctx.db
        .query("taskBrowserSessions")
        .withIndex("by_attempt_id_and_sequence", (index) => index.eq("attemptId", attempt._id))
        .take(MAX_BROWSER_SESSIONS_PER_ATTEMPT);
      for (const session of sessions) {
        const operations = await ctx.db
          .query("taskBrowserOperations")
          .withIndex("by_session_id_and_sequence", (index) => index.eq("sessionId", session._id))
          .take(MAX_BROWSER_OPERATIONS);
        for (const operation of operations) await ctx.db.delete(operation._id);
        const liveView = await ctx.db
          .query("taskLiveViews")
          .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
          .unique();
        if (liveView) await ctx.db.delete(liveView._id);
        const handoff = await ctx.db
          .query("taskHumanHandoffs")
          .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
          .unique();
        if (handoff) await ctx.db.delete(handoff._id);
        await ctx.db.delete(session._id);
      }
      for (const turn of turns) await ctx.db.delete(turn._id);
      await ctx.db.delete(attempt._id);
      await scoutAgent.deleteThreadAsync(ctx, { threadId: attempt.threadId });
    }
    await ctx.db.delete(task._id);
    return null;
  },
});

export const startAttempt = mutation({
  args: {
    taskId: v.id("productTasks"),
    scoutId: v.id("scouts"),
    browserProfile: taskBrowserProfileSelectionValidator,
  },
  returns: v.object({ attemptId: v.id("taskAttempts") }),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const task = await requireOwnedTask(ctx, { taskId: args.taskId, userId });
    const product = await ctx.db.get("products", task.productId);
    if (!product) throw new Error("Task product is unavailable");
    const attempts = await ctx.db
      .query("taskAttempts")
      .withIndex("by_task_id", (index) => index.eq("taskId", task._id))
      .take(MAX_ATTEMPTS_PER_TASK);
    if (attempts.length >= MAX_ATTEMPTS_PER_TASK) {
      throw new Error(`A task can have at most ${MAX_ATTEMPTS_PER_TASK} attempts`);
    }
    const scout = await requireAvailableScout(ctx, args.scoutId, Date.now());
    if (args.browserProfile.kind === "scout" && args.browserProfile.scoutId !== scout._id) {
      throw new Error("Browser profile and attempt must use the same Scout");
    }
    const browserProfile =
      args.browserProfile.kind === "fresh"
        ? ({ kind: "fresh" } as const)
        : ({ kind: "scout", profileName: scout.firecrawl.profileName } as const);
    const createdThread = await scoutAgent.createThread(ctx, {
      userId,
      title: titleFromInstruction(task.instruction),
    });
    const attemptId = await ctx.db.insert("taskAttempts", {
      taskId: task._id,
      scoutId: scout._id,
      threadId: createdThread.threadId,
      browserProfile,
      state: { kind: "active" },
    });
    await enqueueTurn(ctx, {
      threadId: createdThread.threadId,
      userId,
      scoutId: scout._id,
      prompt: task.instruction,
    });
    return { attemptId };
  },
});

export const continueAttempt = mutation({
  args: { attemptId: v.id("taskAttempts"), prompt: v.string() },
  returns: v.object({ turnId: v.id("scoutTurns") }),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const { attempt } = await requireOwnedAttempt(ctx, { attemptId: args.attemptId, userId });
    if (attempt.state.kind === "completed") {
      throw new Error("A completed attempt cannot be continued");
    }
    await requireOwnedAgentThread(ctx, attempt.threadId, userId);
    const turns = await ctx.db
      .query("scoutTurns")
      .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", attempt.threadId))
      .take(MAX_TURNS_PER_ATTEMPT);
    if (turns.some((turn) => turn.state.kind === "pending")) {
      throw new Error("Wait for the current Turn to finish before continuing the attempt");
    }
    if (turns.length >= MAX_TURNS_PER_ATTEMPT) {
      throw new Error(`An attempt can have at most ${MAX_TURNS_PER_ATTEMPT} turns`);
    }
    if (attempt.state.kind === "blocked" || attempt.state.kind === "abandoned") {
      await ctx.db.patch("taskAttempts", attempt._id, { state: { kind: "active" } });
    }
    return {
      turnId: await enqueueTurn(ctx, {
        threadId: attempt.threadId,
        userId,
        scoutId: attempt.scoutId,
        prompt: args.prompt,
      }),
    };
  },
});

export const abandonAttempt = mutation({
  args: { attemptId: v.id("taskAttempts"), conclusion: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const { attempt } = await requireOwnedAttempt(ctx, { attemptId: args.attemptId, userId });
    if (attempt.state.kind === "abandoned") return null;
    if (attempt.state.kind !== "active") {
      throw new Error("Only an active attempt can be abandoned");
    }
    const turns = await ctx.db
      .query("scoutTurns")
      .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", attempt.threadId))
      .take(MAX_TURNS_PER_ATTEMPT);
    if (turns.some((turn) => turn.state.kind === "pending")) {
      throw new Error("An attempt cannot be abandoned while a Turn is pending");
    }
    const sessions = await ctx.db
      .query("taskBrowserSessions")
      .withIndex("by_attempt_id_and_sequence", (index) => index.eq("attemptId", attempt._id))
      .take(MAX_BROWSER_SESSIONS_PER_ATTEMPT);
    for (const session of sessions) {
      const handoff = await ctx.db
        .query("taskHumanHandoffs")
        .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
        .unique();
      if (handoff?.status === "waiting") {
        throw new Error("An attempt cannot be abandoned while human help is pending");
      }
    }
    await ctx.db.patch("taskAttempts", attempt._id, {
      state: {
        kind: "abandoned",
        conclusion: requiredConclusion(args.conclusion),
        resolvedAt: Date.now(),
      },
    });
    return null;
  },
});

export const resolveAttempt = internalMutation({
  args: {
    promptMessageId: v.string(),
    state: v.union(
      v.object({ kind: v.literal("completed"), conclusion: v.string() }),
      v.object({ kind: v.literal("blocked"), conclusion: v.string() }),
    ),
  },
  returns: v.union(
    v.object({ kind: v.literal("completed"), conclusion: v.string(), resolvedAt: v.number() }),
    v.object({ kind: v.literal("blocked"), conclusion: v.string(), resolvedAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (index) =>
        index.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn || turn.state.kind !== "pending") throw new Error("Active task Turn not found");
    const attempt = await ctx.db
      .query("taskAttempts")
      .withIndex("by_thread_id", (index) => index.eq("threadId", turn.threadId))
      .unique();
    if (!attempt || attempt.scoutId !== turn.scoutId)
      throw new Error("Active task Attempt not found");
    if (attempt.state.kind === "completed" || attempt.state.kind === "blocked") {
      return attempt.state;
    }
    if (attempt.state.kind !== "active") throw new Error("Task Attempt is already resolved");
    const session = await ctx.db
      .query("taskBrowserSessions")
      .withIndex("by_turn_id", (index) => index.eq("turnId", turn._id))
      .unique();
    if (!session || session.attemptId !== attempt._id || session.lifecycle.kind !== "closed") {
      throw new Error("Close the task browser session before resolving the Attempt");
    }
    const state = {
      kind: args.state.kind,
      conclusion: requiredConclusion(args.state.conclusion),
      resolvedAt: Date.now(),
    } as const;
    await ctx.db.patch("taskAttempts", attempt._id, { state });
    return state;
  },
});

export const listAttempts = query({
  args: { taskId: v.id("productTasks") },
  returns: v.array(taskAttemptSummaryValidator),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const task = await ctx.db.get("productTasks", args.taskId);
    if (!task || task.userId !== userId) return [];
    const attempts = await ctx.db
      .query("taskAttempts")
      .withIndex("by_task_id", (index) => index.eq("taskId", task._id))
      .order("desc")
      .take(MAX_ATTEMPTS_PER_TASK);
    return await Promise.all(attempts.map(async (attempt) => await projectAttempt(ctx, attempt)));
  },
});

export const listTurns = query({
  args: { attemptId: v.id("taskAttempts") },
  returns: v.array(taskTurnValidator),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const owned = await requireOwnedAttempt(ctx, { attemptId: args.attemptId, userId });
    const turns = await ctx.db
      .query("scoutTurns")
      .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", owned.attempt.threadId))
      .order("asc")
      .take(MAX_TURNS_PER_ATTEMPT);
    return turns.map((turn) => ({
      turnId: turn._id,
      order: turn.order,
      model: turn.model,
      startedAt: turn.startedAt,
      state: turn.state,
    }));
  },
});

export const listMessages = query({
  args: {
    attemptId: v.id("taskAttempts"),
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  returns: uiMessagesResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const { attempt } = await requireOwnedAttempt(ctx, { attemptId: args.attemptId, userId });
    if (attempt.threadId !== args.threadId) throw new Error("Attempt thread does not match");
    await requireOwnedAgentThread(ctx, attempt.threadId, userId);
    const messageArgs = {
      threadId: attempt.threadId,
      paginationOpts: args.paginationOpts,
      streamArgs: args.streamArgs,
    };
    const messages = await listUIMessages(ctx, components.agent, messageArgs);
    const orders = messages.page.map((message) => message.order);
    const firstOrder = orders.length > 0 ? Math.min(...orders) : undefined;
    const lastOrder = orders.length > 0 ? Math.max(...orders) : undefined;
    const turns =
      firstOrder === undefined || lastOrder === undefined
        ? []
        : await ctx.db
            .query("scoutTurns")
            .withIndex("by_thread_id_and_order", (index) =>
              index
                .eq("threadId", attempt.threadId)
                .gte("order", firstOrder)
                .lte("order", lastOrder),
            )
            .collect();
    const scout = await ctx.db.get("scouts", attempt.scoutId);
    if (!scout) throw new Error("Attempt Scout is unavailable");
    const metadataByOrder = new Map<number, MessageMetadata>();
    for (const turn of turns) {
      const terminalAt =
        turn.state.kind === "completed"
          ? turn.state.completedAt
          : turn.state.kind === "failed"
            ? turn.state.failedAt
            : undefined;
      metadataByOrder.set(turn.order, {
        model: turn.model,
        scout: { id: scout._id, displayName: scout.displayName },
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
        if (!metadata) return message;
        return message.role === "assistant" ||
          (message.role === "user" && metadata.failure && !assistantOrders.has(message.order))
          ? { ...message, metadata }
          : message;
      },
    );
    const streams = await syncStreams(ctx, components.agent, messageArgs);
    return { ...messages, page, streams: streams ?? { kind: "list", messages: [] } };
  },
});

export const runtimeContext = internalQuery({
  args: { promptMessageId: v.string() },
  returns: v.union(
    v.object({
      kind: v.literal("task"),
      userId: v.id("users"),
      scoutId: v.id("scouts"),
      taskId: v.id("productTasks"),
      attemptId: v.id("taskAttempts"),
      turnId: v.id("scoutTurns"),
      instruction: v.string(),
      product: v.object({ name: v.string(), domain: v.string(), primaryUrl: v.string() }),
      browserProfile: taskBrowserProfileValidator,
    }),
    v.object({
      kind: v.literal("lab"),
      userId: v.id("users"),
      scoutId: v.id("scouts"),
    }),
  ),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (index) =>
        index.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn) throw new Error("Scout turn not found");
    const attempt = await ctx.db
      .query("taskAttempts")
      .withIndex("by_thread_id", (index) => index.eq("threadId", turn.threadId))
      .unique();
    if (attempt) {
      if (attempt.scoutId !== turn.scoutId)
        throw new Error("Task attempt Scout binding is invalid");
      const task = await ctx.db.get("productTasks", attempt.taskId);
      const product = task ? await ctx.db.get("products", task.productId) : null;
      if (!task || !product) throw new Error("Task runtime context is unavailable");
      return {
        kind: "task" as const,
        userId: task.userId,
        scoutId: attempt.scoutId,
        taskId: task._id,
        attemptId: attempt._id,
        turnId: turn._id,
        instruction: task.instruction,
        product: { name: product.name, domain: product.domain, primaryUrl: product.primaryUrl },
        browserProfile: attempt.browserProfile,
      };
    }
    const labBinding = await ctx.db
      .query("scoutLabThreads")
      .withIndex("by_thread_id", (index) => index.eq("threadId", turn.threadId))
      .unique();
    if (!labBinding || labBinding.scoutId !== turn.scoutId) {
      throw new Error("Scout turn has no runtime binding");
    }
    return {
      kind: "lab" as const,
      userId: labBinding.userId,
      scoutId: labBinding.scoutId,
    };
  },
});

function projectBrowserSession(session: Doc<"taskBrowserSessions">) {
  return {
    sessionId: session._id,
    turnId: session.turnId,
    sequence: session.sequence,
    createdAt: session._creationTime,
    provider: session.provider,
    profileName: session.profileName,
    viewport: session.viewport,
    lifecycle: session.lifecycle,
    operationCount: Math.max(0, session.nextOperationSequence - 1),
  };
}

async function ownedBrowserSession(
  ctx: DatabaseContext,
  args: { sessionId: Id<"taskBrowserSessions">; userId: Id<"users"> },
) {
  const session = await ctx.db.get("taskBrowserSessions", args.sessionId);
  if (!session) return null;
  const owned = await requireOwnedAttempt(ctx, {
    attemptId: session.attemptId,
    userId: args.userId,
  });
  if (owned.attempt.threadId !== (await ctx.db.get("scoutTurns", session.turnId))?.threadId) {
    throw new Error("Browser session has an invalid turn binding");
  }
  return { ...owned, session };
}

export const listBrowserSessions = query({
  args: { attemptId: v.id("taskAttempts") },
  returns: v.array(taskBrowserSessionSummaryValidator),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const { attempt } = await requireOwnedAttempt(ctx, { attemptId: args.attemptId, userId });
    const sessions = await ctx.db
      .query("taskBrowserSessions")
      .withIndex("by_attempt_id_and_sequence", (index) => index.eq("attemptId", attempt._id))
      .order("asc")
      .take(MAX_BROWSER_SESSIONS_PER_ATTEMPT);
    return sessions.map(projectBrowserSession);
  },
});

export const getBrowserSession = query({
  args: { sessionId: v.id("taskBrowserSessions") },
  returns: v.union(taskBrowserSessionDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const owned = await ownedBrowserSession(ctx, { sessionId: args.sessionId, userId });
    if (!owned) return null;
    const operations = await ctx.db
      .query("taskBrowserOperations")
      .withIndex("by_session_id_and_sequence", (index) => index.eq("sessionId", owned.session._id))
      .take(MAX_BROWSER_OPERATIONS);
    return {
      ...projectBrowserSession(owned.session),
      attemptId: owned.attempt._id,
      operations: operations.map((operation) => ({
        operationId: operation._id,
        sequence: operation.sequence,
        toolCallId: operation.toolCallId,
        action: operation.action,
        state: operation.state,
      })),
    };
  },
});

export const liveView = query({
  args: { sessionId: v.id("taskBrowserSessions") },
  returns: v.union(v.object({ url: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const owned = await ownedBrowserSession(ctx, { sessionId: args.sessionId, userId });
    if (!owned || owned.session.lifecycle.kind !== "active") return null;
    const liveView = await ctx.db
      .query("taskLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", owned.session._id))
      .unique();
    return liveView ? { url: requireFirecrawlLiveViewUrl(liveView.liveViewUrl) } : null;
  },
});

export const replayData = internalQuery({
  args: { sessionId: v.id("taskBrowserSessions") },
  returns: v.union(
    v.object({
      providerSessionId: v.string(),
      viewport: taskBrowserViewportValidator,
      lifecycle: taskBrowserSessionLifecycleValidator,
      operations: v.array(taskBrowserOperationValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await requireAppUser(ctx);
    const owned = await ownedBrowserSession(ctx, { sessionId: args.sessionId, userId });
    if (!owned) return null;
    const operations = await ctx.db
      .query("taskBrowserOperations")
      .withIndex("by_session_id_and_sequence", (index) => index.eq("sessionId", owned.session._id))
      .take(MAX_BROWSER_OPERATIONS);
    return {
      providerSessionId: owned.session.providerSessionId,
      viewport: owned.session.viewport,
      lifecycle: owned.session.lifecycle,
      operations: operations.map((operation) => ({
        operationId: operation._id,
        sequence: operation.sequence,
        toolCallId: operation.toolCallId,
        action: operation.action,
        state: operation.state,
      })),
    };
  },
});

export const setBrowserSession = internalMutation({
  args: { promptMessageId: v.string(), providerSessionId: v.string() },
  returns: v.object({
    browserSessionId: v.union(v.id("taskBrowserSessions"), v.null()),
    captureOperations: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const providerSessionId = args.providerSessionId.trim();
    if (!providerSessionId || providerSessionId.length > MAX_BROWSER_SESSION_ID_LENGTH) {
      throw new Error("Firecrawl browser session ID is invalid");
    }
    const turn = await ctx.db
      .query("scoutTurns")
      .withIndex("by_prompt_message_id", (index) =>
        index.eq("promptMessageId", args.promptMessageId),
      )
      .unique();
    if (!turn || turn.state.kind !== "pending") {
      return { browserSessionId: null, captureOperations: false };
    }
    const attempt = await ctx.db
      .query("taskAttempts")
      .withIndex("by_thread_id", (index) => index.eq("threadId", turn.threadId))
      .unique();
    if (!attempt || attempt.scoutId !== turn.scoutId || attempt.state.kind !== "active") {
      return { browserSessionId: null, captureOperations: false };
    }
    const existing = await ctx.db
      .query("taskBrowserSessions")
      .withIndex("by_turn_id", (index) => index.eq("turnId", turn._id))
      .unique();
    if (existing) {
      if (existing.providerSessionId !== providerSessionId) {
        throw new Error("Turn already has a different Firecrawl browser session");
      }
      return { browserSessionId: existing._id, captureOperations: true };
    }
    const latestSession = await ctx.db
      .query("taskBrowserSessions")
      .withIndex("by_attempt_id_and_sequence", (index) => index.eq("attemptId", attempt._id))
      .order("desc")
      .first();
    if (latestSession?.lifecycle.kind === "active") {
      throw new Error("Attempt already has an active browser session");
    }
    if ((latestSession?.sequence ?? 0) >= MAX_BROWSER_SESSIONS_PER_ATTEMPT) {
      throw new Error(`An attempt can have at most ${MAX_BROWSER_SESSIONS_PER_ATTEMPT} sessions`);
    }
    const browserSessionId = await ctx.db.insert("taskBrowserSessions", {
      attemptId: attempt._id,
      turnId: turn._id,
      sequence: (latestSession?.sequence ?? 0) + 1,
      provider: "firecrawl",
      providerSessionId,
      profileName:
        attempt.browserProfile.kind === "scout" ? attempt.browserProfile.profileName : null,
      viewport: TASK_BROWSER_VIEWPORT,
      nextOperationSequence: 1,
      lifecycle: { kind: "active", openedAtMs: Date.now() },
    });
    return { browserSessionId, captureOperations: true };
  },
});

export const prepareBrowserOperation = internalMutation({
  args: {
    sessionId: v.id("taskBrowserSessions"),
    toolCallId: v.string(),
    action: taskBrowserActionValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const toolCallId = args.toolCallId.trim();
    if (!toolCallId || toolCallId.length > MAX_BROWSER_TOOL_CALL_ID_LENGTH) {
      throw new Error("Browser tool call ID is invalid");
    }
    const session = await ctx.db.get("taskBrowserSessions", args.sessionId);
    const turn = session ? await ctx.db.get("scoutTurns", session.turnId) : null;
    const attempt = session ? await ctx.db.get("taskAttempts", session.attemptId) : null;
    if (
      !session ||
      !turn ||
      !attempt ||
      attempt.scoutId !== turn.scoutId ||
      attempt.state.kind !== "active" ||
      turn.state.kind !== "pending" ||
      session.lifecycle.kind !== "active"
    ) {
      throw new Error("Active task browser session not found");
    }
    const duplicate = await ctx.db
      .query("taskBrowserOperations")
      .withIndex("by_session_id_and_tool_call_id", (index) =>
        index.eq("sessionId", session._id).eq("toolCallId", toolCallId),
      )
      .unique();
    if (duplicate) return false;
    const sequence = session.nextOperationSequence;
    if (sequence > MAX_BROWSER_OPERATIONS) {
      throw new Error(`A browser session can have at most ${MAX_BROWSER_OPERATIONS} operations`);
    }
    await ctx.db.patch("taskBrowserSessions", session._id, {
      nextOperationSequence: sequence + 1,
    });
    await ctx.db.insert("taskBrowserOperations", {
      sessionId: session._id,
      sequence,
      toolCallId,
      action: args.action,
      state: { kind: "prepared", preparedAtMs: Date.now() },
    });
    return true;
  },
});

export const settleBrowserOperation = internalMutation({
  args: {
    sessionId: v.id("taskBrowserSessions"),
    toolCallId: v.string(),
    outcome: taskBrowserOutcomeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const operation = await ctx.db
      .query("taskBrowserOperations")
      .withIndex("by_session_id_and_tool_call_id", (index) =>
        index.eq("sessionId", args.sessionId).eq("toolCallId", args.toolCallId.trim()),
      )
      .unique();
    if (!operation) throw new Error("Browser operation not found");
    if (operation.state.kind !== "prepared") return null;
    const settledAtMs = Date.now();
    switch (args.outcome.kind) {
      case "applied":
      case "applied_snapshot_failed":
        await ctx.db.patch("taskBrowserOperations", operation._id, {
          state: { kind: args.outcome.kind, settledAtMs, telemetry: args.outcome.telemetry },
        });
        break;
      case "failed_before_dispatch":
      case "indeterminate_after_dispatch":
        await ctx.db.patch("taskBrowserOperations", operation._id, {
          state: {
            kind: args.outcome.kind,
            settledAtMs,
            failure: truncateText(args.outcome.failure, MAX_BROWSER_FAILURE_LENGTH),
          },
        });
        break;
    }
    return null;
  },
});

export const closeBrowserSessionRecord = internalMutation({
  args: {
    sessionId: v.id("taskBrowserSessions"),
    providerDurationMs: v.union(v.number(), v.null()),
    creditsBilled: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("taskBrowserSessions", args.sessionId);
    if (!session || session.lifecycle.kind === "closed") return null;
    await ctx.db.patch("taskBrowserSessions", session._id, {
      lifecycle: {
        kind: "closed",
        openedAtMs: session.lifecycle.openedAtMs,
        closedAtMs: Date.now(),
        providerDurationMs: args.providerDurationMs,
        creditsBilled: args.creditsBilled,
      },
    });
    return null;
  },
});

export const setLiveView = internalMutation({
  args: { sessionId: v.id("taskBrowserSessions"), liveViewUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("taskBrowserSessions", args.sessionId);
    const turn = session ? await ctx.db.get("scoutTurns", session.turnId) : null;
    const attempt = session ? await ctx.db.get("taskAttempts", session.attemptId) : null;
    if (
      !session ||
      !turn ||
      !attempt ||
      attempt.scoutId !== turn.scoutId ||
      attempt.state.kind !== "active" ||
      turn.state.kind !== "pending" ||
      session.lifecycle.kind !== "active"
    ) {
      return null;
    }
    const liveViewUrl = requireFirecrawlLiveViewUrl(args.liveViewUrl);
    const existing = await ctx.db
      .query("taskLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", session._id))
      .unique();
    if (existing) {
      await ctx.db.replace("taskLiveViews", existing._id, {
        sessionId: session._id,
        liveViewUrl,
        openedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("taskLiveViews", {
        sessionId: session._id,
        liveViewUrl,
        openedAt: Date.now(),
      });
    }
    return null;
  },
});

export const clearLiveView = internalMutation({
  args: { sessionId: v.id("taskBrowserSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const liveView = await ctx.db
      .query("taskLiveViews")
      .withIndex("by_session_id", (index) => index.eq("sessionId", args.sessionId))
      .unique();
    if (liveView) await ctx.db.delete(liveView._id);
    return null;
  },
});
