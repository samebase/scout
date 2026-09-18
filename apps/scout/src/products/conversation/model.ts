import type { FunctionArgs } from "convex/server";
import { z } from "zod";
import type { api } from "../../../convex/_generated/api";
import { reviewFeedSearch } from "#lib/reviewFeedSearch";

export type ProductKind = FunctionArgs<typeof api.scout.chats.startProductChat>["product"]["kind"];

export const productRoutes = { play: "/play", review: "/review" } as const;

export const conversationSearch = z.object({
  ...reviewFeedSearch.shape,
  thread: z.string().min(1).optional(),
  view: z.enum(["walkthrough", "chat"]).optional(),
  session: z.string().min(1).optional().catch(undefined),
  replay: z.object({ sessionId: z.string(), pageId: z.string() }).optional(),
});

export type ConversationSearch = z.infer<typeof conversationSearch>;
