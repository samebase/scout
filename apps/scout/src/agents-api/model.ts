import type { FunctionReturnType } from "convex/server";
import { z } from "zod";
import type { api } from "../../convex/_generated/api";

export const agentsSearch = z.object({
  session: z.string().min(1).optional(),
  step: z.enum(["request_check", "chat"]).optional(),
  browser: z.string().min(1).optional(),
  replayPage: z.string().min(1).optional(),
  view: z.enum(["conversation", "workspace"]).optional(),
  file: z.string().min(1).optional(),
  sessions: z.literal("hidden").optional(),
  inspector: z.literal("hidden").optional(),
  pane: z.enum(["left", "main", "right"]).optional(),
});

export type AgentsSearch = z.infer<typeof agentsSearch>;
export type Session = NonNullable<FunctionReturnType<typeof api.agentsApi.sessions.get>>;
export type BrowserSession = FunctionReturnType<typeof api.agentsApi.sessions.listBrowsers>[number];
export type SessionItem = FunctionReturnType<
  typeof api.agentsApi.sessions.listItems
>["page"][number];

export function selectedStep(session: Session, search: AgentsSearch) {
  if (!session.requestCheck) return "chat";
  if (!session.providerId) return "request_check";
  return search.step ?? "chat";
}

export function sessionControls(state: Session["state"]) {
  switch (state.kind) {
    case "starting":
    case "running":
      return { canSend: false, canStop: true, canResume: false };
    case "waiting":
      return { canSend: false, canStop: true, canResume: true };
    case "idle":
    case "stopped":
    case "failed":
      return { canSend: true, canStop: false, canResume: false };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
