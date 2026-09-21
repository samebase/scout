import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireUserPermission, type ViewerAccess } from "../access";
import { chatPermission, visibleChat } from "../scout/chatAccess";
import { canAccess } from "../../shared/accessModel";

export async function readableSession(
  ctx: Pick<QueryCtx, "db">,
  sessionId: Id<"agentsApiSessions">,
  viewer: ViewerAccess,
) {
  const session = await ctx.db.get(sessionId);
  if (!session) return null;
  if (viewer.kind === "account" && canAccess("access_lab", viewer.accessKeys)) return session;
  return (await visibleChat(ctx, sessionId, viewer)) ? session : null;
}

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
