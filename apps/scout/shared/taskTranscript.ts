import { z } from "zod";

export const taskToolCallSchema = z.object({
  name: z.string(),
  callId: z.string(),
  input: z.json(),
});
