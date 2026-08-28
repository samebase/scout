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

async function insertScout(
  backend: ReturnType<typeof testBackend>,
  identity: { firstName: string; lastName: string; slug: string },
) {
  const displayName = `${identity.firstName} ${identity.lastName}`;
  return await backend.run(
    async (ctx) =>
      await ctx.db.insert("scouts", {
        displayName,
        websiteIdentity: {
          firstName: identity.firstName,
          lastName: identity.lastName,
        },
        slug: identity.slug,
        status: "active",
        agentMail: {
          inboxId: `${identity.slug}@agentmail.to`,
          address: `${identity.slug}@agentmail.to`,
        },
        firecrawl: { profileName: identity.slug },
      }),
  );
}

describe("Scout agent lab", () => {
  it("requires admin access and an active Scout when creating a thread", async () => {
    const backend = testBackend();
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });

    await expect(backend.query(api.scout.lab.listThreads, {})).rejects.toThrow("Not authorized");

    const userId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${userId}|test-session` });
    await expect(nonAdmin.mutation(api.scout.lab.createThread, { scoutId })).rejects.toThrow(
      "Not authorized",
    );

    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    await backend.run(async (ctx) => await ctx.db.patch(scoutId, { status: "disabled" }));
    await expect(admin.mutation(api.scout.lab.createThread, { scoutId })).rejects.toThrow(
      "Active Scout not found",
    );
  });

  it("rejects Agent threads without an application Scout binding", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const unbound = await backend.run(
      async (ctx) => await scoutAgent.createThread(ctx, { userId }),
    );

    await expect(admin.query(api.scout.lab.listThreads, {})).rejects.toThrow(
      "missing its Scout binding",
    );
    await expect(
      admin.query(api.scout.lab.listMessages, {
        threadId: unbound.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow("missing its Scout binding");
    await expect(
      backend.query(internal.scout.lab.getThreadScoutId, {
        threadId: unbound.threadId,
        userId,
      }),
    ).rejects.toThrow("missing its Scout binding");
  });

  it("isolates bound threads and reports completed generation metadata", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });

    const created = await admin.mutation(api.scout.lab.createThread, { scoutId });
    await expect(admin.query(api.scout.lab.listThreads, {})).resolves.toEqual([
      {
        threadId: created.threadId,
        creationTime: expect.any(Number),
        title: null,
        scoutId,
      },
    ]);
    await admin.mutation(api.scout.lab.sendMessage, {
      threadId: created.threadId,
      prompt: "  Say hello.  ",
      model: "qwen/qwen3.7-flash",
    });

    const generation = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutLabGenerations")
          .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", created.threadId))
          .unique(),
    );
    expect(generation).toMatchObject({
      threadId: created.threadId,
      scoutId,
      status: "pending",
      leaseExpiresAt: expect.any(Number),
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
    expect(messages.page[1]).toMatchObject({
      role: "assistant",
      text: "Hello.",
      metadata: {
        model: "qwen/qwen3.7-flash",
        scout: { id: scoutId, displayName: "Conrad Scout" },
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

  it("serializes work by the Scout bound to each thread", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });
    const firstThread = await admin.mutation(api.scout.lab.createThread, { scoutId });
    const secondThread = await admin.mutation(api.scout.lab.createThread, { scoutId });

    await expect(
      backend.query(internal.scout.lab.getThreadScoutId, {
        threadId: firstThread.threadId,
        userId,
      }),
    ).resolves.toBe(scoutId);
    await admin.mutation(api.scout.lab.sendMessage, {
      threadId: firstThread.threadId,
      prompt: "Inspect the account page.",
    });
    await expect(
      admin.mutation(api.scout.lab.sendMessage, {
        threadId: secondThread.threadId,
        prompt: "Start another browser session.",
      }),
    ).rejects.toThrow("Scout is already working");

    const generation = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutLabGenerations")
          .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", firstThread.threadId))
          .unique(),
    );
    if (!generation) {
      throw new Error("Expected a lab generation record");
    }
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: {},
    });
    await backend.run(async (ctx) => await ctx.db.patch(scoutId, { status: "disabled" }));
    await expect(
      admin.mutation(api.scout.lab.sendMessage, {
        threadId: secondThread.threadId,
        prompt: "Continue as a disabled Scout.",
      }),
    ).rejects.toThrow("Active Scout not found");
  });

  it("expires abandoned work and records terminal failures", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });
    const created = await admin.mutation(api.scout.lab.createThread, { scoutId });
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

    const nextThread = await admin.mutation(api.scout.lab.createThread, { scoutId });
    await admin.mutation(api.scout.lab.sendMessage, {
      threadId: nextThread.threadId,
      prompt: "Retry after recovery.",
    });
    const nextGeneration = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutLabGenerations")
          .withIndex("by_thread_id_and_order", (q) => q.eq("threadId", nextThread.threadId))
          .unique(),
    );
    if (!nextGeneration) {
      throw new Error("Expected a second lab generation record");
    }
    await backend.mutation(internal.scout.lab.failGeneration, {
      promptMessageId: nextGeneration.promptMessageId,
      failure: "Provider request failed",
      firecrawlCredits: 1,
      firecrawlDurationMs: 800,
    });
    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutLabGenerations", nextGeneration._id)),
    ).resolves.toMatchObject({
      status: "failed",
      failure: "Provider request failed",
      firecrawlCredits: 1,
      firecrawlDurationMs: 800,
    });
  });

  it("uses the default model and rejects the retired model", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });
    const created = await admin.mutation(api.scout.lab.createThread, { scoutId });

    await expect(
      admin.mutation(api.scout.lab.sendMessage, {
        threadId: created.threadId,
        prompt: "Try the retired model.",
        // @ts-expect-error Deliberately cross the generated API boundary with a retired model.
        model: "qwen/qwen3.8-flash",
      }),
    ).rejects.toThrow();
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
