import { tool } from "ai";
import { z } from "zod";

const MAX_ATTEMPT_CONCLUSION_LENGTH = 500;

const attemptResolutionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("completed"),
      conclusion: z.string().trim().min(1).max(MAX_ATTEMPT_CONCLUSION_LENGTH),
    })
    .strict(),
  z
    .object({
      kind: z.literal("blocked"),
      conclusion: z.string().trim().min(1).max(MAX_ATTEMPT_CONCLUSION_LENGTH),
    })
    .strict(),
]);

export type AttemptResolution = z.infer<typeof attemptResolutionSchema>;

export type AttemptResolutionResult = {
  kind: AttemptResolution["kind"];
  conclusion: string;
  resolvedAt: number;
};

export function createAttemptResolutionTool(
  resolve: (resolution: AttemptResolution) => Promise<AttemptResolutionResult>,
  isArmed: () => boolean,
) {
  let used = false;
  return tool({
    description:
      "Finish this Task attempt after the browser is closed. Choose completed only when the objective is achieved with sufficient evidence; otherwise choose blocked and briefly state what prevented completion. CAPTCHA or human-help expiry is not a resolution: leave the attempt active for the operator to continue.",
    inputSchema: attemptResolutionSchema,
    execute: async (input) => {
      const resolution = attemptResolutionSchema.parse(input);
      if (!isArmed()) {
        throw new Error("Attempt resolution is available only after the browser closes");
      }
      if (used) {
        throw new Error("Attempt resolution can be used only once");
      }
      const result = await resolve(resolution);
      used = true;
      return result;
    },
  });
}
