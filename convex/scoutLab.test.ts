/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";
import { scoutAgent } from "./scout/agent";
import { DEFAULT_SCOUT_MODEL } from "./scout/models";

const modules = import.meta.glob("./**/*.ts");

function testBackend() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  return backend;
}

async function insertUser(backend: ReturnType<typeof testBackend>, email: string) {
  return await backend.run(async (ctx) => await ctx.db.insert("users", { email }));
}

describe("Scout agent lab", () => {
  it("rejects unauthenticated and non-admin access", async () => {
    const backend = testBackend();

    await expect(backend.query(api.scout.lab.listThreads, {})).rejects.toThrow("Not authorized");

    const userId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${userId}|test-session` });
    await expect(nonAdmin.mutation(api.scout.lab.createThread, {})).rejects.toThrow(
      "Not authorized",
    );
  });

  it("isolates threads and reports completed Qwen generation metadata", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });

    const created = await admin.mutation(api.scout.lab.createThread, {});
    await expect(admin.query(api.scout.lab.listThreads, {})).resolves.toMatchObject([
      { threadId: created.threadId, title: null },
    ]);

    await admin.mutation(api.scout.lab.sendMessage, {
      threadId: created.threadId,
      prompt: "  Say hello.  ",
      model: "qwen/qwen3.7-flash",
    });
    await expect(admin.query(api.scout.lab.listThreads, {})).resolves.toMatchObject([
      { threadId: created.threadId, title: "Say hello." },
    ]);
    const generation = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutLabGenerations")
          .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", created.threadId))
          .unique(),
    );
    expect(generation).toMatchObject({
      threadId: created.threadId,
      model: "qwen/qwen3.7-flash",
    });
    if (!generation) {
      throw new Error("Expected a lab generation record");
    }

    await backend.run(
      async (ctx) =>
        await scoutAgent.saveMessage(ctx, {
          threadId: created.threadId,
          userId,
          promptMessageId: generation.promptMessageId,
          message: { role: "assistant", content: "Hello." },
          skipEmbeddings: true,
        }),
    );
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: {
        promptTokens: 123,
        completionTokens: 7,
        totalTokens: 130,
        cachedInputTokens: 100,
      },
      firecrawlCredits: 2,
      firecrawlDurationMs: 1_500,
    });

    const messages = await admin.query(api.scout.lab.listMessages, {
      threadId: created.threadId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(messages.page).toHaveLength(2);
    expect(messages.page[0]).toMatchObject({
      role: "user",
      text: "Say hello.",
      parts: [{ type: "text", text: "Say hello." }],
    });
    expect(messages.page[1]).toMatchObject({
      role: "assistant",
      text: "Hello.",
      metadata: {
        model: "qwen/qwen3.7-flash",
        usage: {
          promptTokens: 123,
          completionTokens: 7,
          totalTokens: 130,
          cachedInputTokens: 100,
        },
        firecrawlCredits: 2,
        firecrawlDurationMs: 1_500,
      },
    });
    expect(messages.page[1]?.metadata?.durationMs).toBeGreaterThanOrEqual(0);

    const secondUserId = await insertUser(backend, ADMIN_EMAIL);
    const secondAdmin = backend.withIdentity({ subject: `${secondUserId}|other-session` });
    await expect(secondAdmin.query(api.scout.lab.listThreads, {})).resolves.toEqual([]);
    await expect(
      secondAdmin.query(api.scout.lab.listMessages, {
        threadId: created.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow("Thread not found");
  });

  it("records a sanitized terminal failure for the generation sidecar", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const created = await admin.mutation(api.scout.lab.createThread, {});
    await admin.mutation(api.scout.lab.sendMessage, {
      threadId: created.threadId,
      prompt: "Inspect a page.",
    });
    const generation = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutLabGenerations")
          .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", created.threadId))
          .unique(),
    );
    if (!generation) {
      throw new Error("Expected a lab generation record");
    }

    await backend.mutation(internal.scout.lab.failGeneration, {
      promptMessageId: generation.promptMessageId,
      failure: "Provider request failed",
      firecrawlCredits: 1,
      firecrawlDurationMs: 800,
    });

    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutLabGenerations", generation._id)),
    ).resolves.toMatchObject({
      failure: "Provider request failed",
      firecrawlCredits: 1,
      firecrawlDurationMs: 800,
    });
    await expect(
      admin.query(api.scout.lab.listMessages, {
        threadId: created.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).resolves.toMatchObject({
      page: [
        {
          role: "user",
          metadata: {
            failure: "Provider request failed",
            firecrawlCredits: 1,
            firecrawlDurationMs: 800,
          },
        },
      ],
    });
  });

  it("rejects the retired Qwen model", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const created = await admin.mutation(api.scout.lab.createThread, {});

    await expect(
      admin.mutation(api.scout.lab.sendMessage, {
        threadId: created.threadId,
        prompt: "Try the retired model.",
        // @ts-expect-error Deliberately cross the generated API boundary with a retired model.
        model: "qwen/qwen3.8-flash",
      }),
    ).rejects.toThrow();
  });

  it("keeps the previous Lab client contract during deployment", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const created = await admin.mutation(api.scout.lab.createThread, {});

    await expect(admin.query(api.scout.lab.latestThread, {})).resolves.toEqual(created);
    await admin.mutation(api.scout.lab.sendMessage, {
      threadId: created.threadId,
      prompt: "Use the default model.",
    });
    const generation = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutLabGenerations")
          .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", created.threadId))
          .unique(),
    );
    expect(generation?.model).toBe(DEFAULT_SCOUT_MODEL);
  });
});
