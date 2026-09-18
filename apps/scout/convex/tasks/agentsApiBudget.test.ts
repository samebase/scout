import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { INSUFFICIENT_CREDITS_MESSAGE } from "../../shared/creditFailure";
import { executeTaskTool } from "./execution";

vi.mock("./execution", async (original) => ({
  ...(await original<typeof import("./execution")>()),
  executeTaskTool: vi.fn(async () => ({ kind: "success" as const, output: "done" })),
}));

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(executeTaskTool).mockClear();
});

async function setup(status: "requires_action" | "idle") {
  vi.stubEnv("CREDITS_ENABLED", "true");
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  const backend = convexTest(schema, modules);
  const { userId, sessionId } = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      slug: "scout",
      status: "active",
      agentMail: { inboxId: "scout", address: "scout@example.test" },
      firecrawl: { profileName: "scout-profile" },
    });
    const sessionId = await ctx.db.insert("agentsApiSessions", {
      engine: "agents_api",
      userId,
      scoutId,
      scoutName: "Scout",
      title: "Test",
      model: "gpt-5.6-luna",
      state: { kind: "running" },
      active: true,
      providerId: "session-test",
      nextSequence: 0,
      browser: null,
      usage: null,
    });
    return { userId, sessionId };
  });
  await backend.mutation(internal.credits.grantOnSignIn, { userId });
  await backend.run(async (ctx) => {
    await ctx.db.patch(sessionId, { billingEnabled: true });
    const wallet = await ctx.db
      .query("creditWallets")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .unique();
    if (!wallet) throw new Error("Missing wallet");
    await ctx.db.patch(wallet._id, { balanceUnits: -10 });
  });

  const inputEvents: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path.endsWith("/sessions/session-test"))
        return Response.json({
          status,
          usage: {
            input_tokens: 0,
            output_tokens: 500_000,
            total_tokens: 500_000,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
          required_actions: [
            {
              type: "function_call",
              call_id: "call-test",
              turn_id: "turn-test",
              name: "test_tool",
              arguments: {},
            },
          ],
        });
      if (request.method === "GET" && path.endsWith("/sessions/session-test/items"))
        return Response.json({ data: [], has_more: false });
      if (request.method === "GET" && path.endsWith("/sessions/session-test/turns"))
        return Response.json({
          data: [{ id: "turn-test", status: "completed", subagent_id: null, usage: null }],
          has_more: false,
        });
      if (request.method === "GET" && path.endsWith("/sessions/session-test/events"))
        return new Response(new ReadableStream({ start: (controller) => controller.close() }), {
          headers: { "Content-Type": "text/event-stream" },
        });
      if (request.method === "POST" && path.endsWith("/sessions/session-test/events")) {
        inputEvents.push(await request.json());
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected provider request: ${request.method} ${path}`);
    }),
  );
  return { backend, sessionId, inputEvents };
}

it("stops before continuing provider work when the actual balance is negative", async () => {
  const { backend, sessionId, inputEvents } = await setup("requires_action");
  await expect(backend.action(internal.tasks.runtime.advance, { sessionId })).rejects.toThrow(
    INSUFFICIENT_CREDITS_MESSAGE,
  );
  expect(executeTaskTool).not.toHaveBeenCalled();
  expect(inputEvents).toEqual([]);
  expect(
    await backend.query(internal.tasks.sessions.cleanupResources, { sessionId }),
  ).toMatchObject({
    usage: { inputTokens: 0, outputTokens: 500_000, cachedInputTokens: 0 },
  });
});

it("still finalizes an idle turn when the actual balance is negative", async () => {
  const { backend, sessionId, inputEvents } = await setup("idle");
  await expect(backend.action(internal.tasks.runtime.advance, { sessionId })).resolves.toBe(false);
  expect(executeTaskTool).not.toHaveBeenCalled();
  expect(inputEvents).toEqual([]);
  expect(
    await backend.query(internal.tasks.sessions.cleanupResources, { sessionId }),
  ).toMatchObject({
    active: false,
    state: { kind: "idle" },
  });
});
