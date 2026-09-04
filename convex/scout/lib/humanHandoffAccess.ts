"use node";

import { createHash, createHmac } from "node:crypto";
import { humanHandoffOrigin, humanHandoffUrl, isHumanHandoffAccessToken } from "./humanHandoffUrl";

export { humanHandoffOrigin, humanHandoffUrl, isHumanHandoffAccessToken };

const HUMAN_HANDOFF_TOKEN_CONTEXT = "scout-human-handoff-access-v1";

export function deriveHumanHandoffAccessToken(promptMessageId: string, agentMailApiKey: string) {
  const normalizedPromptMessageId = promptMessageId.trim();
  const normalizedApiKey = agentMailApiKey.trim();
  if (!normalizedPromptMessageId) throw new Error("Prompt message ID is required");
  if (!normalizedApiKey) throw new Error("AGENTMAIL_API_KEY is not configured");
  const digest = createHmac("sha256", normalizedApiKey)
    .update(HUMAN_HANDOFF_TOKEN_CONTEXT)
    .update("\0")
    .update(normalizedPromptMessageId)
    .digest("base64url");
  return `hh1_${digest}`;
}

export function hashHumanHandoffAccessToken(value: string) {
  if (!isHumanHandoffAccessToken(value)) {
    throw new Error("Human handoff access token is invalid");
  }
  return createHash("sha256").update(value).digest("hex");
}
