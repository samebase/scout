import { tool } from "ai";
import { z } from "zod";
import { sendEmail, type SendEmailArgs } from "../email";

const MAX_HANDOFF_REASON_LENGTH = 500;
const STATUS_POLL_INTERVAL_MS = 2_000;

type HumanHandoffStatus = "waiting" | "continued" | "expired" | "missing";

type HumanHandoffRequest<HandoffId> = {
  handoffId: HandoffId;
  created: boolean;
  recipientEmail: string;
  productName: string;
  scoutName: string;
  interactiveLiveViewUrl: string;
  expiresAt: number;
};

type HumanHandoffCallbacks<HandoffId> = {
  request: (reason: string) => Promise<HumanHandoffRequest<HandoffId>>;
  getStatus: (handoffId: HandoffId) => Promise<HumanHandoffStatus>;
  expire: (handoffId: HandoffId) => Promise<HumanHandoffStatus>;
};

type HumanHandoffDependencies = {
  sendEmail: (args: SendEmailArgs) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
};

const defaultDependencies: HumanHandoffDependencies = {
  sendEmail,
  sleep: async (milliseconds) =>
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  now: Date.now,
};

function emailHeader(value: string) {
  return value
    .trim()
    .replaceAll(/[\r\n]+/g, " ")
    .slice(0, 120);
}

export function humanHandoffEmail<HandoffId>(
  request: HumanHandoffRequest<HandoffId>,
  reason: string,
): SendEmailArgs {
  const scoutName = emailHeader(request.scoutName) || "Scout";
  const productName = emailHeader(request.productName) || "the product";
  return {
    to: request.recipientEmail,
    subject: `${scoutName} needs help with ${productName}`,
    text: `${scoutName} reached a step that requires a person while testing ${productName}.

Reason: ${reason}

Open this temporary browser link and complete only the requested human check:
${request.interactiveLiveViewUrl}

For the most reliable drag controls, open the link on a desktop computer. Mobile drag controls may be unreliable.

Then return to the already-open Scout task and press Continue. This request expires in about five minutes.`,
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
      const request = await callbacks.request(reason);
      if (request.created) {
        try {
          await dependencies.sendEmail(humanHandoffEmail(request, reason));
        } catch (emailError) {
          try {
            await callbacks.expire(request.handoffId);
          } catch (expirationError) {
            throw new AggregateError(
              [emailError, expirationError],
              "Scout could not email the human-help request or close it",
            );
          }
          throw new Error("Scout could not email the human-help request", { cause: emailError });
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
          return {
            resumed: false,
            message:
              "The human-help request expired. Stop this browser path and explain how the operator can resume the still-active attempt.",
          };
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
      if (finalStatus === "expired") {
        return {
          resumed: false,
          message:
            "The human-help request expired. Stop this browser path and explain how the operator can resume the still-active attempt.",
        };
      }
      return {
        resumed: false,
        message:
          "The human-help request expired. Stop this browser path and explain how the operator can resume the still-active attempt.",
      };
    },
  });
}
