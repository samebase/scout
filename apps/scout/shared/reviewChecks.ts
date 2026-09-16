import { z } from "zod";

export const reviewChecksSchema = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(120),
      result: z.enum(["passed", "failed", "untested"]),
      explanation: z.string().trim().min(1).max(400),
    }),
  )
  .min(1)
  .max(10);

export type ReviewCheck = z.infer<typeof reviewChecksSchema>[number];
