import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { scoutAgent } from "./agent";

type AgentThreadContext = QueryCtx | MutationCtx | ActionCtx;

export async function requireOwnedAgentThread(
  ctx: AgentThreadContext,
  threadId: string,
  userId: string,
) {
  const thread = await scoutAgent.getThreadMetadata(ctx, { threadId });
  if (thread.userId !== userId) {
    throw new Error("Thread not found");
  }
  return thread;
}
