import OpenAI from "openai";
import { getRuntimeEnv } from "../runtimeEnv";

export function openAIClient() {
  const apiKey = getRuntimeEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey, maxRetries: 0, timeout: 60_000 });
}
