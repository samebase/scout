import { afterEach, describe, expect, it } from "vitest";
import { browserBridgeRequestSchema } from "../../src/lib/scoutRunnerProtocol.ts";
import { ScoutRunnerBridgeServer } from "./bridge.ts";

const siteUrl = "http://localhost:5173";
const browserClientId = "1cf391e5-c15d-4f47-9aef-7617cc55f64b";
let bridge: ScoutRunnerBridgeServer | undefined;

afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

function browserHeaders(secret: string) {
  return {
    authorization: `Bearer ${secret}`,
    origin: siteUrl,
    "content-type": "application/json",
  };
}

describe("ScoutRunnerBridgeServer", () => {
  it("pairs one browser and relays a chat-bound tool call", async () => {
    bridge = new ScoutRunnerBridgeServer(siteUrl);
    const connection = await bridge.start();
    const registered = await fetch(new URL("/api/register", connection.runnerUrl), {
      method: "POST",
      headers: browserHeaders(connection.secret),
      body: JSON.stringify({ clientId: browserClientId }),
    });
    expect(registered.status).toBe(200);
    await bridge.waitForBrowser(100);

    const preparing = bridge.prepare("conrad", "Read the page heading.");
    const prepareRequest = browserBridgeRequestSchema.parse(
      await (
        await fetch(new URL("/api/next", connection.runnerUrl), {
          headers: browserHeaders(connection.secret),
        })
      ).json(),
    );
    expect(prepareRequest.kind).toBe("prepare");
    expect(prepareRequest).toMatchObject({ prompt: "Read the page heading." });
    const preparedValue = {
      threadId: "thread-1",
      promptMessageId: "prompt-1",
      chatUrl: "http://localhost:5173/chats?thread=thread-1&view=live",
      instructions: "Use Scout tools.",
      tools: [
        {
          name: "browser_close",
          description: "Close the browser.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    };
    await fetch(new URL("/api/respond", connection.runnerUrl), {
      method: "POST",
      headers: browserHeaders(connection.secret),
      body: JSON.stringify({
        kind: "success",
        requestId: prepareRequest.requestId,
        value: preparedValue,
      }),
    });
    await expect(preparing).resolves.toEqual(preparedValue);

    const toolCallResponse = fetch(new URL("/api/tool-call", connection.runnerUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        threadId: "thread-1",
        toolName: "browser_close",
        input: {},
      }),
    });
    const toolRequest = browserBridgeRequestSchema.parse(
      await (
        await fetch(new URL("/api/next", connection.runnerUrl), {
          headers: browserHeaders(connection.secret),
        })
      ).json(),
    );
    expect(toolRequest).toMatchObject({
      kind: "callTool",
      threadId: "thread-1",
      promptMessageId: "prompt-1",
      toolName: "browser_close",
      input: {},
    });
    const manualResult = {
      toolCallId: "manual-1",
      outcome: { kind: "success", output: JSON.stringify({ success: true }) },
    };
    await fetch(new URL("/api/respond", connection.runnerUrl), {
      method: "POST",
      headers: browserHeaders(connection.secret),
      body: JSON.stringify({
        kind: "success",
        requestId: toolRequest.requestId,
        value: manualResult,
      }),
    });
    await expect((await toolCallResponse).json()).resolves.toEqual(manualResult);
    expect(bridge.toolCalls()).toEqual([
      { toolName: "browser_close", input: {}, result: manualResult },
    ]);

    const finishing = bridge.finish({ kind: "completed", response: "Example Domain" });
    const finishRequest = browserBridgeRequestSchema.parse(
      await (
        await fetch(new URL("/api/next", connection.runnerUrl), {
          headers: browserHeaders(connection.secret),
        })
      ).json(),
    );
    expect(finishRequest).toMatchObject({
      kind: "finish",
      threadId: "thread-1",
      promptMessageId: "prompt-1",
      outcome: { kind: "completed", response: "Example Domain" },
    });
    await fetch(new URL("/api/respond", connection.runnerUrl), {
      method: "POST",
      headers: browserHeaders(connection.secret),
      body: JSON.stringify({
        kind: "success",
        requestId: finishRequest.requestId,
        value: null,
      }),
    });
    await expect(finishing).resolves.toBeUndefined();
  });

  it("rejects the wrong browser origin", async () => {
    bridge = new ScoutRunnerBridgeServer(siteUrl);
    const connection = await bridge.start();
    const response = await fetch(new URL("/api/register", connection.runnerUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.secret}`,
        origin: "http://malicious.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ clientId: browserClientId }),
    });
    expect(response.status).toBe(403);
  });

  it("accepts registration replay from the same browser and rejects another browser", async () => {
    bridge = new ScoutRunnerBridgeServer(siteUrl);
    const connection = await bridge.start();
    const register = (clientId: string) =>
      fetch(new URL("/api/register", connection.runnerUrl), {
        method: "POST",
        headers: browserHeaders(connection.secret),
        body: JSON.stringify({ clientId }),
      });

    expect((await register(browserClientId)).status).toBe(200);
    expect((await register(browserClientId)).status).toBe(200);
    expect((await register("673a373e-9cae-4557-8779-9f2cbdc64b32")).status).toBe(409);
  });
});
