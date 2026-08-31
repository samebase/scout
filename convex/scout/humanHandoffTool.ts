import { tool } from "ai";
import { z } from "zod";
import { sendEmail, type SendEmailArgs } from "../email";

const MAX_HANDOFF_REASON_LENGTH = 500;
const STATUS_POLL_INTERVAL_MS = 2_000;
const EMAIL_DELIVERY_TIMEOUT_MS = 15_000;

type HumanHandoffStatus = "waiting" | "continued" | "expired" | "failed" | "missing";

type HumanHandoffRequest<HandoffId> = {
  handoffId: HandoffId;
  created: boolean;
  recipientEmail: string;
  productName: string;
  scoutName: string;
  handoffUrl: string;
  expiresAt: number;
};

type HumanHandoffCallbacks<HandoffId> = {
  request: (reason: string) => Promise<HumanHandoffRequest<HandoffId>>;
  getStatus: (handoffId: HandoffId) => Promise<HumanHandoffStatus>;
  expire: (handoffId: HandoffId) => Promise<HumanHandoffStatus>;
  failDelivery: (handoffId: HandoffId) => Promise<HumanHandoffStatus>;
  closeBrowser: () => Promise<void>;
};

type HumanHandoffDependencies = {
  sendEmail: typeof sendEmail;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  timeoutSignal?: (milliseconds: number) => AbortSignal;
};

const defaultDependencies: HumanHandoffDependencies = {
  sendEmail,
  sleep: async (milliseconds) =>
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  now: Date.now,
  timeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
};

function emailHeader(value: string) {
  return value
    .trim()
    .replaceAll(/[\r\n]+/g, " ")
    .slice(0, 120);
}

function stoppedHandoffResult(outcome: "expired" | "failed") {
  return outcome === "failed"
    ? {
        resumed: false,
        status: "failed" as const,
        message:
          "The human-help request failed. Stop this browser path and explain how the operator can resume the still-active attempt.",
      }
    : {
        resumed: false,
        message:
          "The human-help request expired. Stop this browser path and explain how the operator can resume the still-active attempt.",
      };
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

Open this temporary Scout link and complete only the requested human check:
${request.handoffUrl}

For the most reliable drag controls, open the link on a desktop computer. Mobile drag controls may be unreliable.

Then press Continue Scout on the handoff page. This request expires in no more than five minutes.`,
  };
}

export function createHumanHandoffTool<HandoffId>(
  callbacks: HumanHandoffCallbacks<HandoffId>,
  dependencies: HumanHandoffDependencies = defaultDependencies,
) {
  return tool({
    description:
      "Ask the authenticated human operator to take over the current browser for a CAPTCHA or another strictly human-only check. The browser session stays open while you wait. Use this instead of attempting to solve a CAPTCHA.",
    inputSchema: z.object({
      reason: z.string().trim().min(1).max(MAX_HANDOFF_REASON_LENGTH),
    }),
    execute: async ({ reason }) => {
      const stop = async (outcome: "expired" | "failed") => {
        await callbacks.closeBrowser();
        return stoppedHandoffResult(outcome);
      };
      const request = await callbacks.request(reason);
      if (request.created) {
        try {
          const remainingMs = request.expiresAt - dependencies.now();
          if (remainingMs <= 0) {
            throw new Error("The human-help request expired before email delivery started");
          }
          const timeoutSignal =
            dependencies.timeoutSignal ?? ((milliseconds) => AbortSignal.timeout(milliseconds));
          await dependencies.sendEmail(humanHandoffEmail(request), {
            signal: timeoutSignal(Math.min(EMAIL_DELIVERY_TIMEOUT_MS, remainingMs)),
          });
        } catch (emailError) {
          try {
            const status = await callbacks.failDelivery(request.handoffId);
            if (status === "continued") {
              return {
                resumed: true,
                message:
                  "The operator finished the human-only step. Inspect the current browser state before continuing.",
              };
            }
            if (status === "expired") {
              return await stop("expired");
            }
            if (status === "missing") {
              throw new Error("The human-help request disappeared after email delivery failed");
            }
            if (status === "failed") {
              return await stop("failed");
            }
            throw new Error("The failed email delivery left the human-help request waiting");
          } catch (failureError) {
            throw new AggregateError(
              [emailError, failureError],
              "Scout could not email the human-help request or mark it failed",
            );
          }
        }
      }

      while (dependencies.now() < request.expiresAt) {
        const status = await callbacks.getStatus(request.handoffId);
        if (status === "continued") {
          return {
            resumed: true,
            message:
              "The operator finished the human-only step. Inspect the current browser state before continuing.",
          };
        }
        if (status === "expired") {
          return await stop("expired");
        }
        if (status === "failed") {
          return await stop("failed");
        }
        if (status === "missing") {
          throw new Error("The human-help request disappeared while Scout was waiting");
        }
        const remainingMs = request.expiresAt - dependencies.now();
        await dependencies.sleep(Math.min(STATUS_POLL_INTERVAL_MS, Math.max(0, remainingMs)));
      }

      const finalStatus = await callbacks.expire(request.handoffId);
      if (finalStatus === "continued") {
        return {
          resumed: true,
          message:
            "The operator finished the human-only step. Inspect the current browser state before continuing.",
        };
      }
      if (finalStatus === "missing") {
        throw new Error("The human-help request disappeared while Scout was waiting");
      }
      if (finalStatus === "failed") {
        return await stop("failed");
      }
      if (finalStatus === "expired") {
        return await stop("expired");
      }
      return await stop("expired");
    },
  });
}
