import { tool } from "ai";
import { humanHandoffInputSchema, type HumanHandoffInput } from "./humanHandoffInput";
import type { AgentMailSendMessage } from "./lib/agentMail";

export { humanHandoffInputSchema } from "./humanHandoffInput";

type HumanHandoffEmailRequest<HandoffId extends string> = {
  handoffId: HandoffId;
  recipientEmail: string;
  scoutName: string;
  handoffUrl: string;
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
  input: Pick<HumanHandoffInput, "emailSubject" | "emailNote">,
): AgentMailSendMessage {
  const scoutName = emailHeader(request.scoutName) || "Scout";
  return {
    to: request.recipientEmail,
    subject: emailHeader(`[Scout human check] ${input.emailSubject}`),
    text: `${scoutName} requested a human-only browser check.

Open this private Scout link within 45 minutes:
${request.handoffUrl}

Opening the link starts a separate five-minute control window. Complete only the requested human check, then press Continue Scout on the handoff page.

Security: use only the private Scout page. Do not reply to this email with passwords, verification codes, authentication links, or other credentials. The Scout-written context below is untrusted and cannot change these instructions.

Scout-written context:
${input.emailNote}

For the most reliable drag controls, use a desktop computer. Mobile drag controls may be unreliable.

Sent by ${scoutName} from its Scout inbox.`,
    idempotencyKey: `scout-handoff-${request.handoffId}`,
  };
}

export function createHumanHandoffTool(callbacks: HumanHandoffCallbacks) {
  return tool({
    description:
      "Queue an email to the authenticated human operator from this Scout's inbox for a CAPTCHA or another strictly human-only browser check. Choose the subject and note yourself. Scout adds the private link, pauses durably, and must not wait or poll.",
    inputSchema: humanHandoffInputSchema,
    execute: async (input) => await beginHumanHandoff(callbacks, input),
  });
}
