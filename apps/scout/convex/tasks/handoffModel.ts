import { v } from "convex/values";
import { taskFailureDiagnosticValidator } from "../../shared/taskFailure";

export const handoffAccess = v.object({
  callId: v.string(),
  turnId: v.string(),
  providerSessionId: v.string(),
  expiresAt: v.number(),
  tokenHash: v.string(),
});

const activePage = {
  scoutName: v.string(),
  expiresAt: v.number(),
};

export const handoffPage = v.union(
  v.object({ status: v.literal("invalid") }),
  v.object({ status: v.literal("expired") }),
  v.object({ status: v.literal("stopped") }),
  v.object({ status: v.literal("declined") }),
  v.object({
    status: v.literal("failed"),
    error: v.string(),
    diagnostic: v.union(taskFailureDiagnosticValidator, v.null()),
  }),
  v.object({ status: v.literal("continued"), scoutName: v.string() }),
  v.object({ status: v.literal("checking"), ...activePage }),
  v.object({
    status: v.literal("waiting"),
    ...activePage,
    message: v.string(),
    interactiveLiveViewUrl: v.string(),
    checkMessage: v.union(v.string(), v.null()),
  }),
);
