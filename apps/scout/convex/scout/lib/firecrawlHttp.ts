import { z } from "zod";
import { getRuntimeEnv } from "../../runtimeEnv";

const errorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  requestId: z.string().optional(),
});

export class FirecrawlApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function firecrawlRequest(path: string, init: RequestInit) {
  const apiKey = getRuntimeEnv("FIRECRAWL_API_KEY")?.trim();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  const method = init.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`https://api.firecrawl.dev${path}`, { ...init, headers });
  } catch (error) {
    console.error(`Firecrawl ${method} ${path} failed before receiving a response`);
    throw error;
  }
  if (!response.ok) {
    const parsed = errorSchema.safeParse(await response.json().catch(() => null));
    const details = parsed.success ? parsed.data : undefined;
    const requestId = response.headers.get("x-request-id") ?? details?.requestId;
    const message = [
      `Firecrawl ${method} ${path}: HTTP ${response.status}`,
      details?.error ?? details?.message ?? response.statusText,
      details?.code,
      requestId ? `Request ID: ${requestId}` : null,
    ]
      .filter(Boolean)
      .join(". ");
    console.error(`Firecrawl ${method} ${path} failed with HTTP ${response.status}`);
    throw new FirecrawlApiError(message, response.status);
  }
  return response;
}
