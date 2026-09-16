import OpenAI from "openai";
import { env } from "./_generated/server";

export function client() {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  if (!env.OPENAI_WEBHOOK_SECRET) throw new Error("OPENAI_WEBHOOK_SECRET is not configured");
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    webhookSecret: env.OPENAI_WEBHOOK_SECRET,
    maxRetries: 3,
    timeout: 60_000,
  });
}
