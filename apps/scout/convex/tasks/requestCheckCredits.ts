import type { Id } from "../_generated/dataModel";

export const MAX_REQUEST_CHECK_OUTPUT_TOKENS = 1_200;

export function requestCheckCreditSourceKey(checkId: Id<"agentsApiRequestChecks">) {
  return `request_check:${checkId}`;
}
