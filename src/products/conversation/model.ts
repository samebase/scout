import type { FunctionArgs } from "convex/server";
import { z } from "zod";
import type { api } from "../../../convex/_generated/api";

export type ProductKind = FunctionArgs<typeof api.scout.chats.startProductChat>["kind"];

export const productRoutes = { play: "/play", review: "/review" } as const;

export const conversationSearch = z.object({
  thread: z.string().min(1).optional(),
  session: z.string().min(1).optional().catch(undefined),
  replay: z.object({ sessionId: z.string(), pageId: z.string() }).optional(),
});

export type ConversationSearch = z.infer<typeof conversationSearch>;
