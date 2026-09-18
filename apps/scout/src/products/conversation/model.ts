import type { FunctionArgs } from "convex/server";
import { z } from "zod";
import { linkOptions } from "@tanstack/react-router";
import type { api } from "../../../convex/_generated/api";
import { reviewFeedSearch } from "#lib/reviewFeedSearch";

export type ProductKind = FunctionArgs<typeof api.scout.chats.startProductChat>["product"]["kind"];

export const conversationSearch = z.object({
  ...reviewFeedSearch.shape,
  view: z.enum(["walkthrough", "chat"]).optional(),
  session: z.string().min(1).optional().catch(undefined),
  replay: z.object({ sessionId: z.string(), pageId: z.string() }).optional(),
});

export type ConversationSearch = z.infer<typeof conversationSearch>;

export const playSearch = conversationSearch.extend({ thread: z.string().min(1).optional() });

export function conversationDestination(
  kind: ProductKind,
  thread: string,
  search: ConversationSearch,
) {
  return kind === "play"
    ? linkOptions({ to: "/play", search: { ...search, thread } })
    : linkOptions({ to: "/tasks/$thread", params: { thread }, search });
}
