import OpenAI from "openai";
import { z } from "zod";
import { getRuntimeEnv } from "../runtimeEnv";

const eventRequest = z.object({
  events: z.array(
    z.object({
      type: z.string(),
      turn_id: z.string().optional(),
      call_id: z.string().optional(),
    }),
  ),
});
const errorResponse = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().nullish(),
    code: z.string().nullish(),
    param: z.string().nullish(),
  }),
});

export function openAIClient(sessionId: string) {
  const apiKey = getRuntimeEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({
    apiKey,
    maxRetries: 3,
    timeout: 60_000,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const startedAt = Date.now();
      const submitted =
        request.method === "POST" && path.endsWith("/events")
          ? eventRequest.safeParse(
              await request
                .clone()
                .json()
                .catch(() => null),
            )
          : null;
      const metadata = {
        sessionId,
        method: request.method,
        path,
        retryCount: request.headers.get("x-stainless-retry-count"),
        events: submitted?.success ? submitted.data.events : null,
      };
      let response: Response;
      try {
        response = await fetch(input, init);
      } catch (error) {
        console.error("OpenAI request failed", {
          ...metadata,
          elapsedMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      if (!response.ok) {
        const body = errorResponse.safeParse(
          await response
            .clone()
            .json()
            .catch(() => null),
        );
        console.error("OpenAI request failed", {
          ...metadata,
          elapsedMs: Date.now() - startedAt,
          httpStatus: response.status,
          requestId: response.headers.get("x-request-id"),
          error: body.success ? body.data.error : null,
        });
      } else if (submitted?.success) {
        console.info("OpenAI input accepted", {
          ...metadata,
          elapsedMs: Date.now() - startedAt,
          httpStatus: response.status,
          requestId: response.headers.get("x-request-id"),
        });
      }
      return response;
    },
  });
}
