"use node";

import { createHash, createHmac } from "node:crypto";
import { isHumanHandoffAccessToken } from "./humanHandoffUrl";

export function deriveHumanHandoffAccessToken(
  handoff: {
    sessionId: string;
    callId: string;
    turnId: string;
    providerSessionId: string;
    expiresAt: number;
  },
  agentMailApiKey: string,
) {
  const digest = createHmac("sha256", agentMailApiKey)
    .update("scout-task-handoff-access-v1\0")
    .update(
      JSON.stringify([
        handoff.sessionId,
        handoff.callId,
        handoff.turnId,
        handoff.providerSessionId,
        handoff.expiresAt,
      ]),
    )
    .digest("base64url");
  return `hh1_${digest}`;
}

export function hashHumanHandoffAccessToken(value: string) {
  if (!isHumanHandoffAccessToken(value)) return null;
  return createHash("sha256").update(value).digest("hex");
}
