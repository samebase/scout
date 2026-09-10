"use node";

export const FIRECRAWL_DEADLINE_MS = 90_000;

export async function withFirecrawlDeadline<T>(request: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Firecrawl request timed out after 90 seconds."));
      }, FIRECRAWL_DEADLINE_MS);
    });
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
