import type { FunctionReturnType } from "convex/server";
import { z } from "zod";
import type { api } from "../../convex/_generated/api";

export const labSearch = z.object({
  scout: z.string().min(1).optional(),
  session: z.string().min(1).optional(),
  step: z
    .enum(["request_check", "site_research", "chat", "walkthrough", "walkthrough_update"])
    .optional(),
  check: z.string().min(1).optional(),
  call: z.string().min(1).optional(),
  browser: z.string().min(1).optional(),
  replayPage: z.string().min(1).optional(),
  view: z.enum(["conversation", "workspace"]).optional(),
  file: z.string().min(1).optional(),
  sessions: z.literal("hidden").optional(),
  inspector: z.literal("hidden").optional(),
  pane: z.enum(["left", "main", "right"]).optional(),
});

export type LabSearch = z.infer<typeof labSearch>;
export type Session = NonNullable<FunctionReturnType<typeof api.tasks.sessions.get>>;
export type RequestCheck = NonNullable<FunctionReturnType<typeof api.tasks.requestChecks.inspect>>;
export type WalkthroughReport = NonNullable<
  FunctionReturnType<typeof api.tasks.walkthroughReports.inspect>
>;
export type SiteResearch = NonNullable<
  FunctionReturnType<typeof api.tasks.siteResearchRecords.inspect>
>;
export type BrowserSession = FunctionReturnType<typeof api.tasks.sessions.listBrowsers>[number];
export type SessionItem = FunctionReturnType<typeof api.tasks.sessions.listItems>["page"][number];

export function selectedStep(session: Session, search: LabSearch) {
  return (
    search.step ??
    (!session.hasChat && session.research
      ? "site_research"
      : !session.hasChat && session.checks.length > 0
        ? "request_check"
        : "chat")
  );
}

export function selectedCheckId(session: Session, search: LabSearch) {
  return search.check ?? session.checks.find((check) => check.kind === "initial")?._id;
}

export function sessionControls(state: Session["state"]) {
  switch (state.kind) {
    case "starting":
    case "checking":
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
