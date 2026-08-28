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

  it("binds a thread to one active Scout and cannot switch identities", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const scoutIds = await backend.run(async (ctx) => {
      const first = await ctx.db.insert("scouts", {
        displayName: "Conrad",
        slug: "conrad",
        status: "active",
        agentMail: { inboxId: "conrad@agentmail.to", address: "conrad@agentmail.to" },
        firecrawl: { profileName: "conrad" },
      });
      const second = await ctx.db.insert("scouts", {
        displayName: "Ada",
        slug: "ada",
        status: "active",
        agentMail: { inboxId: "ada@agentmail.to", address: "ada@agentmail.to" },
        firecrawl: { profileName: "ada" },
      });
      return { first, second };
    });

    const created = await admin.mutation(api.scout.lab.createThread, {
      scoutId: scoutIds.first,
    });
    await expect(admin.query(api.scout.lab.listThreads, {})).resolves.toMatchObject([
      { threadId: created.threadId, scoutId: scoutIds.first },
    ]);
    await expect(
      backend.query(internal.scout.lab.getThreadScoutId, {
        threadId: created.threadId,
        userId,
      }),
    ).resolves.toBe(scoutIds.first);
    await admin.mutation(api.scout.lab.sendMessage, {
      threadId: created.threadId,
      prompt: "Inspect the account page.",
      scoutId: scoutIds.first,
    });
    await expect(
      admin.query(api.scout.lab.getScoutActivity, { scoutId: scoutIds.first }),
    ).resolves.toEqual({ active: true });
    const secondThread = await admin.mutation(api.scout.lab.createThread, {
      scoutId: scoutIds.first,
    });
    await expect(
      admin.mutation(api.scout.lab.sendMessage, {
        threadId: secondThread.threadId,
        prompt: "Start another browser session.",
        scoutId: scoutIds.first,
      }),
    ).rejects.toThrow("Scout is already working");
    const generation = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutLabGenerations")
          .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", created.threadId))
          .unique(),
    );
    expect(generation).toMatchObject({ scoutId: scoutIds.first, status: "pending" });
    if (!generation) {
      throw new Error("Expected a lab generation record");
    }
    await expect(
      backend.mutation(internal.scout.lab.startGeneration, {
        promptMessageId: generation.promptMessageId,
      }),
    ).resolves.toBe(true);
    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutLabGenerations", generation._id)),
    ).resolves.toMatchObject({ status: "pending" });

    await expect(
      admin.mutation(api.scout.lab.sendMessage, {
        threadId: created.threadId,
        prompt: "Switch identities.",
        scoutId: scoutIds.second,
      }),
    ).rejects.toThrow("cannot switch Scouts");

    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: {},
    });
    await expect(
      admin.query(api.scout.lab.getScoutActivity, { scoutId: scoutIds.first }),
    ).resolves.toEqual({ active: false });

    await backend.run(async (ctx) => await ctx.db.patch(scoutIds.first, { status: "disabled" }));
    await expect(
      admin.mutation(api.scout.lab.sendMessage, {
        threadId: created.threadId,
        prompt: "Continue as a disabled Scout.",
        scoutId: scoutIds.first,
      }),
    ).rejects.toThrow("Active Scout not found");
  });

  it("releases a Scout when a scheduled generation never starts", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const scoutId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scouts", {
          displayName: "Conrad",
          slug: "conrad",
          status: "active",
          agentMail: { inboxId: "conrad@agentmail.to", address: "conrad@agentmail.to" },
          firecrawl: { profileName: "conrad" },
        }),
    );
    const created = await admin.mutation(api.scout.lab.createThread, { scoutId });
    await admin.mutation(api.scout.lab.sendMessage, {
      threadId: created.threadId,
      prompt: "Inspect the account page.",
      scoutId,
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

    await backend.run(
      async (ctx) => await ctx.db.patch(generation._id, { leaseExpiresAt: Date.now() - 1 }),
    );
    await backend.mutation(internal.scout.lab.expireGeneration, {
      generationId: generation._id,
    });

    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutLabGenerations", generation._id)),
    ).resolves.toMatchObject({
      status: "failed",
      failure: "Generation stopped before completion",
    });
    await expect(admin.query(api.scout.lab.getScoutActivity, { scoutId })).resolves.toEqual({
      active: false,
    });
    const nextThread = await admin.mutation(api.scout.lab.createThread, { scoutId });
    await expect(
      admin.mutation(api.scout.lab.sendMessage, {
        threadId: nextThread.threadId,
        prompt: "Retry after recovery.",
        scoutId,
      }),
    ).resolves.toBeNull();
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
