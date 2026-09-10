import { generateText } from "ai";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { scoutLanguageModel } from "./models";
import { SCOUT_REASONING_EFFORTS } from "../../shared/scoutReasoning";

afterEach(() => vi.unstubAllGlobals());

test.each(SCOUT_REASONING_EFFORTS)(
  "sends Luna %s effort in the gateway HTTP request",
  async (effort) => {
    vi.stubGlobal("Convex", {
      asyncSyscall: async (operation: string, args: string) => {
        expect(operation).toBe("1.0/createServiceToken");
        expect(JSON.parse(args)).toMatchObject({ service: "ai-gateway" });
        return JSON.stringify("test-deployment-token");
      },
    });
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: "test-response",
            created: 1,
            model: "openai/gpt-5.6-luna",
            choices: [
              { index: 0, message: { role: "assistant", content: "Done." }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateText({
      model: scoutLanguageModel("openai/gpt-5.6-luna"),
      prompt: "Reply briefly.",
      providerOptions: { convexGateway: { reasoningEffort: effort } },
      maxRetries: 0,
    });

    expect(result.text).toBe("Done.");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = fetchMock.mock.calls[0][1]?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(body)).toMatchObject({
      model: "openai/gpt-5.6-luna",
      reasoning_effort: effort,
    });
  },
);
