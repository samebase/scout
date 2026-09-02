import { tool } from "ai";
import { z } from "zod";

const attemptResolutionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("completed"),
      conclusion: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("blocked"),
      conclusion: z.string().trim().min(1),
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
) {
  let used = false;
  return tool({
    description:
      "Finish this Task attempt. This final action closes any open browser and persists the Attempt verdict. Choose completed only when the objective is achieved with sufficient evidence; otherwise choose blocked and briefly state what prevented completion. CAPTCHA or human-help expiry is not a resolution: request human help instead so the Attempt remains available to continue.",
    inputSchema: attemptResolutionSchema,
    execute: async (input) => {
      const resolution = attemptResolutionSchema.parse(input);
      if (used) {
        throw new Error("Attempt resolution can be used only once");
      }
      const result = await resolve(resolution);
      used = true;
      return result;
    },
  });
}
