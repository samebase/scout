import { z } from "zod";

export const chatSearchSchema = z.object({
  thread: z.string().optional().catch(undefined),
  session: z.string().optional().catch(undefined),
  call: z.string().optional().catch(undefined),
  replayPage: z.string().optional().catch(undefined),
  view: z.enum(["workspace", "new"]).optional().catch(undefined),
  file: z.string().startsWith("/workspace/").optional().catch(undefined),
  pane: z.enum(["left", "main", "right"]).optional().catch(undefined),
  chats: z.literal("hidden").optional().catch(undefined),
  inspector: z.literal("hidden").optional().catch(undefined),
  context: z.literal("open").optional().catch(undefined),
  terminal: z.literal("hidden").optional().catch(undefined),
});

export function defaultChatPane(search: z.output<typeof chatSearchSchema>) {
  return search.view !== "new" && (search.view === "workspace" || search.call) ? "right" : "main";
}
