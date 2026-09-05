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
    subject: emailHeader(`[Scout handoff] ${scoutName} is ready for you`),
    text: `${scoutName} has paused so you can take control of the browser.

Open this private Scout link before ${new Date(request.claimExpiresAt).toISOString()}:
${request.handoffUrl}

Opening the link starts a separate five-minute control window. When you are finished, press Continue Scout on the handoff page.

Security: use only the private Scout page. Do not reply to this email with passwords, verification codes, authentication links, or other credentials. The page describes the requested browser interaction.

For the most reliable drag controls, use a desktop computer. Mobile drag controls may be unreliable.

Sent by ${scoutName} from its Scout inbox.`,
    idempotencyKey: `scout-handoff-${request.handoffId}`,
  };
}

export function createHumanHandoffTool(callbacks: HumanHandoffCallbacks) {
  return tool({
    description:
      "Hand the open browser to the user when they ask to take over, or when a visible CAPTCHA, device verification, or another human-only control blocks the task. A user-requested takeover does not require a visible challenge. Open the user's requested page first if no browser is open. Describe the requested interaction in at most 500 characters. This tool creates the private handoff and queues its email to the chat owner's saved address; do not send a separate email. Report a handoff only after this tool succeeds. Call this exactly once as the only tool call in the response, then stop.",
    inputSchema: humanHandoffInputSchema,
    execute: async (input) => await beginHumanHandoff(callbacks, input),
  });
}
