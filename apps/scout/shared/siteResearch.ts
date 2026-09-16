import { z } from "zod";

const publicUrl = z
  .string()
  .regex(/^https:\/\/[^\s<>]+$/)
  .refine((value) => {
    const url = URL.parse(value);
    return url !== null && !url.username && !url.password;
  });

export const siteBrief = z.object({
  name: z.string().trim().min(1).max(120),
  overview: z.string().trim().min(1).max(1_000),
  facts: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(1_000),
        sources: z.array(publicUrl).min(1).max(6),
      }),
    )
    .max(6),
  unknowns: z.array(z.string().max(500)).max(4),
});
