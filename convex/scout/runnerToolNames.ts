import { v } from "convex/values";

export const runnerToolNames = [
  "create_new_firecrawl_session",
  "browser_execute",
  "browser_close",
  "list_messages",
  "search_messages",
  "get_thread",
  "fill_account_password",
  "record_authenticated_service_account",
  "web_search",
  "web_read",
] as const;

export const runnerToolNameValidator = v.union(
  v.literal(runnerToolNames[0]),
  v.literal(runnerToolNames[1]),
  v.literal(runnerToolNames[2]),
  v.literal(runnerToolNames[3]),
  v.literal(runnerToolNames[4]),
  v.literal(runnerToolNames[5]),
  v.literal(runnerToolNames[6]),
  v.literal(runnerToolNames[7]),
  v.literal(runnerToolNames[8]),
  v.literal(runnerToolNames[9]),
);

export type RunnerToolName = typeof runnerToolNameValidator.type;
