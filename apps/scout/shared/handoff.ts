export const HANDOFF_RESPONSE_WINDOW_MS = 45 * 60 * 1_000;
export const FIRECRAWL_BROWSER_TTL_SECONDS = 3_600;
export const HANDOFF_EXPIRED_REASON =
  "Task stopped because no one resumed Scout before the browser handoff deadline.";

export function handoffDeadlineMessage(expiresAt: number, timeZone: string | undefined) {
  const deadline = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(expiresAt);
  return `Resume Scout by ${deadline}. After this deadline, the task stops and its browser closes.`;
}
