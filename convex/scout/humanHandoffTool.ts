import { tool } from "ai";
import { humanHandoffInputSchema, type HumanHandoffInput } from "./humanHandoffInput";
import type { AgentMailSendMessage } from "./lib/agentMail";

export { humanHandoffInputSchema } from "./humanHandoffInput";

type HumanHandoffEmailRequest<HandoffId extends string> = {
  handoffId: HandoffId;
  recipientEmail: string;
  scoutName: string;
  handoffUrl: string;
  claimExpiresAt: number;
};

export type HumanHandoffCallbacks = {
  request: (input: HumanHandoffInput) => Promise<void>;
  onWaiting: () => void;
};

export async function beginHumanHandoff(
  callbacks: HumanHandoffCallbacks,
  input: HumanHandoffInput,
) {
  await callbacks.request(input);
  callbacks.onWaiting();
  return {
    status: "waiting" as const,
    message:
      "The human-help email is being delivered from the Scout's inbox. Scout is paused durably and will resume after the operator returns control.",
  };
}

function emailHeader(value: string) {
  return value
    .trim()
    .replaceAll(/[\r\n]+/g, " ")
    .slice(0, 120);
}

export function humanHandoffEmail<HandoffId extends string>(
  request: HumanHandoffEmailRequest<HandoffId>,
): AgentMailSendMessage {
  const scoutName = emailHeader(request.scoutName) || "Scout";
  return {
    to: request.recipientEmail,
    subject: emailHeader(`[Scout human check] ${scoutName} needs your help`),
    text: `${scoutName} requested a human-only browser check.

Open this private Scout link before ${new Date(request.claimExpiresAt).toISOString()}:
${request.handoffUrl}

Opening the link starts a separate five-minute control window. Complete only the requested human check, then press Continue Scout on the handoff page.

Security: use only the private Scout page. Do not reply to this email with passwords, verification codes, authentication links, or other credentials. The page will show the check that blocked Scout.

For the most reliable drag controls, use a desktop computer. Mobile drag controls may be unreliable.

Sent by ${scoutName} from its Scout inbox.`,
    idempotencyKey: `scout-handoff-${request.handoffId}`,
  };
}

export function createHumanHandoffTool(callbacks: HumanHandoffCallbacks) {
  return tool({
    description:
      "Pause for a human only when the current browser page visibly requires a CAPTCHA, device verification, or another control that Playwright cannot operate. Do not use this for OAuth or permission consent, navigation, slow loading, an unfamiliar page, a failed selector, or a tool error. The reason appears beside the live browser: describe the exact visible interaction, without a link or a request to navigate elsewhere. Scout writes the email and adds its private handoff link. Call this exactly once as the only tool call in the response, then stop.",
    inputSchema: humanHandoffInputSchema,
    execute: async (input) => await beginHumanHandoff(callbacks, input),
  });
}
