import { tool } from "ai";
import { z } from "zod";
import { sendEmail, type SendEmailArgs } from "../email";

const MAX_HANDOFF_REASON_LENGTH = 500;
const EMAIL_DELIVERY_TIMEOUT_MS = 15_000;

type HumanHandoffStatus =
  | "available"
  | "active"
  | "continued"
  | "resumed"
  | "expired"
  | "failed"
  | "missing";

type HumanHandoffRequest<HandoffId> = {
  handoffId: HandoffId;
  created: boolean;
  recipientEmail: string;
  productName: string;
  scoutName: string;
  handoffUrl: string;
  claimExpiresAt: number;
};

export type HumanHandoffCallbacks<HandoffId> = {
  request: (reason: string) => Promise<HumanHandoffRequest<HandoffId>>;
  failDelivery: (handoffId: HandoffId) => Promise<HumanHandoffStatus>;
  onWaiting: () => void;
};

type HumanHandoffDependencies = {
  sendEmail: typeof sendEmail;
  now: () => number;
  timeoutSignal?: (milliseconds: number) => AbortSignal;
};

const defaultDependencies: HumanHandoffDependencies = {
  sendEmail,
  now: Date.now,
  timeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
};

export async function beginHumanHandoff<HandoffId>(
  callbacks: HumanHandoffCallbacks<HandoffId>,
  reason: string,
  dependencies: HumanHandoffDependencies = defaultDependencies,
) {
  const request = await callbacks.request(reason);
  if (request.created) {
    try {
      const remainingMs = request.claimExpiresAt - dependencies.now();
      if (remainingMs <= 0) {
        throw new Error("The human-help link expired before email delivery started");
      }
      const timeoutSignal =
        dependencies.timeoutSignal ?? ((milliseconds) => AbortSignal.timeout(milliseconds));
      await dependencies.sendEmail(humanHandoffEmail(request), {
        signal: timeoutSignal(Math.min(EMAIL_DELIVERY_TIMEOUT_MS, remainingMs)),
      });
    } catch (emailError) {
      try {
        const status = await callbacks.failDelivery(request.handoffId);
        if (status !== "failed" && status !== "expired") {
          throw new Error(`Email delivery failed while handoff status became ${status}`);
        }
      } catch (failureError) {
        throw new AggregateError(
          [emailError, failureError],
          "Scout could not email the human-help request or mark it failed",
        );
      }
      throw emailError;
    }
  }
  callbacks.onWaiting();
  return {
    status: "waiting" as const,
    message:
      "The human-help email was sent. Scout is paused durably and will resume after the operator returns control.",
  };
}

function emailHeader(value: string) {
  return value
    .trim()
    .replaceAll(/[\r\n]+/g, " ")
    .slice(0, 120);
}

export function humanHandoffEmail<HandoffId>(
  request: HumanHandoffRequest<HandoffId>,
): SendEmailArgs {
  const scoutName = emailHeader(request.scoutName) || "Scout";
  const productName = emailHeader(request.productName) || "the product";
  return {
    to: request.recipientEmail,
    subject: `${scoutName} needs help with ${productName}`,
    text: `${scoutName} reached a step that requires a person while testing ${productName}.

Open this private Scout link within 45 minutes:
${request.handoffUrl}

Opening the link starts a separate five-minute control window. Complete only the requested human check, then press Continue Scout on the handoff page.

For the most reliable drag controls, use a desktop computer. Mobile drag controls may be unreliable.`,
  };
}

export function createHumanHandoffTool<HandoffId>(
  callbacks: HumanHandoffCallbacks<HandoffId>,
  dependencies: HumanHandoffDependencies = defaultDependencies,
) {
  return tool({
    description:
      "Email the authenticated human operator a private link for a CAPTCHA or another strictly human-only browser check. Scout pauses durably after sending it; do not wait or poll.",
    inputSchema: z.object({
      reason: z.string().trim().min(1).max(MAX_HANDOFF_REASON_LENGTH),
    }),
    execute: async ({ reason }) => await beginHumanHandoff(callbacks, reason, dependencies),
  });
}
