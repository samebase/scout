import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { FIRECRAWL_DEADLINE_MS, withFirecrawlDeadline } from "./firecrawlDeadline";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Firecrawl component deadline", () => {
  test("returns the request result and clears the deadline timer", async () => {
    const page = { markdown: "Complete page" };
    const request = vi.fn(async () => page);

    await expect(withFirecrawlDeadline(request)).resolves.toBe(page);

    expect(request).toHaveBeenCalledExactlyOnceWith();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("preserves request rejection and clears the deadline timer", async () => {
    const failure = new Error("Firecrawl rejected the URL");

    await expect(withFirecrawlDeadline(() => Promise.reject(failure))).rejects.toBe(failure);

    expect(vi.getTimerCount()).toBe(0);
  });

  test("clears the deadline timer when dispatch throws synchronously", async () => {
    const failure = new Error("Component is unavailable");

    await expect(
      withFirecrawlDeadline(() => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(vi.getTimerCount()).toBe(0);
  });

  test("fails a stalled request at the deadline without retrying it", async () => {
    const request = vi.fn(() => new Promise<never>(() => undefined));
    const result = withFirecrawlDeadline(request);
    const settled = vi.fn();
    void result.then(settled, settled);
    const timedOut = expect(result).rejects.toThrow(
      "Firecrawl request timed out after 90 seconds.",
    );

    await vi.advanceTimersByTimeAsync(FIRECRAWL_DEADLINE_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(request).toHaveBeenCalledExactlyOnceWith();
    expect(settled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["resolve", "reject"])(
    "handles a late %s after the deadline without changing the timeout result",
    async (outcome) => {
      const result = withFirecrawlDeadline(
        () =>
          new Promise<string>((resolve, reject) => {
            setTimeout(() => {
              if (outcome === "resolve") resolve("Late page");
              else reject(new Error("Late provider failure"));
            }, FIRECRAWL_DEADLINE_MS + 1);
          }),
      );
      const timedOut = expect(result).rejects.toThrow(
        "Firecrawl request timed out after 90 seconds.",
      );

      await vi.advanceTimersByTimeAsync(FIRECRAWL_DEADLINE_MS);
      await timedOut;
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).rejects.toThrow("Firecrawl request timed out after 90 seconds.");
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
