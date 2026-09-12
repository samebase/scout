import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireUserPermission } from "../access";
import { chatPermission } from "../scout/chatAccess";

export async function requireSessionPermission(
  ctx: Pick<QueryCtx, "db">,
  session: Doc<"agentsApiSessions">,
) {
  const chat = await ctx.db
    .query("scoutChats")
    .withIndex("by_thread_id", (q) => q.eq("threadId", session._id))
    .unique();
  await requireUserPermission(
    ctx,
    session.userId,
    chat ? chatPermission(chat.purpose) : "access_lab",
  );
  return chat;
}
