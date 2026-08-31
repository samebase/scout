import { v } from "convex/values";
import { taskBrowserProfileValidator } from "./taskAttemptModel";
import {
  taskBrowserOperationValidator,
  taskBrowserSessionLifecycleValidator,
  taskBrowserViewportValidator,
} from "./taskBrowserModel";
import { scoutModelValidator, scoutTurnStateValidator } from "./scout/models";

export const taskSummaryValidator = v.object({
  taskId: v.id("productTasks"),
  instruction: v.string(),
  createdAt: v.number(),
  attemptCount: v.number(),
  latestAttempt: v.union(
    v.object({
      attemptId: v.id("taskAttempts"),
      createdAt: v.number(),
      scoutName: v.string(),
      state: scoutTurnStateValidator,
    }),
    v.null(),
  ),
});

export const taskDetailValidator = v.object({
  taskId: v.id("productTasks"),
  instruction: v.string(),
  createdAt: v.number(),
  product: v.object({
    name: v.string(),
    domain: v.string(),
    primaryUrl: v.string(),
  }),
});

export const taskAttemptSummaryValidator = v.object({
  attemptId: v.id("taskAttempts"),
  createdAt: v.number(),
  threadId: v.string(),
  browserProfile: taskBrowserProfileValidator,
  scout: v.object({
    id: v.id("scouts"),
    displayName: v.string(),
  }),
  state: scoutTurnStateValidator,
  turnCount: v.number(),
  browserSessionCount: v.number(),
});

export const taskTurnValidator = v.object({
  turnId: v.id("scoutTurns"),
  order: v.number(),
  model: scoutModelValidator,
  startedAt: v.number(),
  state: scoutTurnStateValidator,
});

export const taskBrowserSessionSummaryValidator = v.object({
  sessionId: v.id("taskBrowserSessions"),
  turnId: v.id("scoutTurns"),
  sequence: v.number(),
  createdAt: v.number(),
  provider: v.literal("firecrawl"),
  profileName: v.union(v.string(), v.null()),
  viewport: taskBrowserViewportValidator,
  lifecycle: taskBrowserSessionLifecycleValidator,
  operationCount: v.number(),
});

export const taskBrowserSessionDetailValidator = taskBrowserSessionSummaryValidator.extend({
  attemptId: v.id("taskAttempts"),
  operations: v.array(taskBrowserOperationValidator),
});
