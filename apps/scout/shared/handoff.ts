export const HANDOFF_RESPONSE_WINDOW_MS = 45 * 60 * 1_000;
export const HANDOFF_ACTIVE_WINDOW_MS = 10 * 60 * 1_000;
export const FIRECRAWL_BROWSER_TTL_SECONDS = 3_600;
export const HANDOFF_EXPIRED_REASON =
  "Task stopped because no one resumed Scout before the browser handoff deadline.";
export const HANDOFF_DECLINED_REASON =
  "Task stopped because the person helping could not complete the browser check.";

export function handoffDeadlineMessage(
  expiresAt: number,
  timeZone: string | undefined,
  phase: "open" | "resume" = "resume",
) {
  const deadline = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(expiresAt);
  return phase === "open"
    ? `Open the browser by ${deadline}. You then have up to ${HANDOFF_ACTIVE_WINDOW_MS / 60_000} minutes to complete the check.`
    : `Resume Scout by ${deadline}. After this deadline, the task stops and its browser closes.`;
}
