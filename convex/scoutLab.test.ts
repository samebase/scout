/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

type TestBackend = ReturnType<typeof testBackend>;
type AuthenticatedTestBackend = ReturnType<TestBackend["withIdentity"]>;

async function insertUser(backend: ReturnType<typeof testBackend>, email: string) {
  return await backend.run(async (ctx) => await ctx.db.insert("users", { email }));
}

async function insertScout(
  backend: TestBackend,
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

async function createExperiment(client: AuthenticatedTestBackend, scoutId: Id<"scouts">) {
  return await client.mutation(api.scout.lab.createExperiment, {
    name: "Tally form lifecycle",
    scoutId,
    targetProduct: "Tally",
    targetDomain: "tally.so",
    objective: "Verify a form from creation through response evidence.",
  });
}

async function createLabThread(client: AuthenticatedTestBackend, scoutId: Id<"scouts">) {
  const { experimentId } = await createExperiment(client, scoutId);
  const created = await client.mutation(api.scout.lab.createThread, { experimentId });
  return { ...created, experimentId };
}

async function listLabThreadPage(
  client: AuthenticatedTestBackend,
  paginationOpts: { cursor: string | null; numItems: number } = { cursor: null, numItems: 50 },
) {
  return await client.query(api.scout.lab.listThreads, { paginationOpts });
}

async function listLabThreads(client: AuthenticatedTestBackend) {
  return (await listLabThreadPage(client)).page;
}

async function insertLegacyLabThread(
  backend: TestBackend,
  args: {
    userId: Id<"users">;
    scoutId: Id<"scouts">;
    title: string;
  },
) {
  return await backend.run(async (ctx) => {
    const created = await scoutAgent.createThread(ctx, {
      userId: args.userId,
      title: args.title,
    });
    await ctx.db.insert("scoutLabThreads", {
      threadId: created.threadId,
      userId: args.userId,
      scoutId: args.scoutId,
      createdAt: Date.now(),
    });
    return created;
  });
}

describe("Scout agent lab", () => {
  it("requires admin access and an active Scout when creating a thread", async () => {
    const backend = testBackend();
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });

    await expect(
      backend.query(api.scout.lab.listThreads, {
        paginationOpts: { cursor: null, numItems: 50 },
      }),
    ).rejects.toThrow("Not authorized");

    const userId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${userId}|test-session` });

    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    const { experimentId } = await createExperiment(admin, scoutId);
    await expect(nonAdmin.mutation(api.scout.lab.createThread, { experimentId })).rejects.toThrow(
      "Not authorized",
    );

    await backend.run(async (ctx) => await ctx.db.patch(scoutId, { status: "disabled" }));
    const historicalExperiment = await createExperiment(admin, scoutId);
    await expect(admin.mutation(api.scout.lab.createThread, historicalExperiment)).rejects.toThrow(
      "Active Scout not found",
    );
  });

  it("normalizes experiments and isolates them by authenticated user", async () => {
    const backend = testBackend();
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });

    await expect(backend.query(api.scout.lab.listExperiments, {})).rejects.toThrow(
      "Not authorized",
    );
    const nonAdminId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(
      nonAdmin.mutation(api.scout.lab.createExperiment, {
        name: "Tally form lifecycle",
        scoutId,
        targetProduct: "Tally",
        targetDomain: "tally.so",
        objective: "Verify the complete form lifecycle.",
      }),
    ).rejects.toThrow("Not authorized");

    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    const { experimentId } = await admin.mutation(api.scout.lab.createExperiment, {
      name: "  Tally form lifecycle  ",
      scoutId,
      targetProduct: "  Tally  ",
      targetDomain: "  HTTPS://Tally.SO/forms/  ",
      objective: "  Verify the complete form lifecycle.  ",
    });

    await expect(admin.query(api.scout.lab.listExperiments, {})).resolves.toEqual([
      {
        _id: experimentId,
        _creationTime: expect.any(Number),
        name: "Tally form lifecycle",
        scoutId,
        targetProduct: "Tally",
        targetDomain: "tally.so",
        objective: "Verify the complete form lifecycle.",
        status: "active",
      },
    ]);

    const otherAdminId = await insertUser(backend, ADMIN_EMAIL);
    const otherAdmin = backend.withIdentity({ subject: `${otherAdminId}|other-session` });
    await expect(otherAdmin.query(api.scout.lab.listExperiments, {})).resolves.toEqual([]);
    await expect(
      otherAdmin.mutation(api.scout.lab.setExperimentStatus, {
        experimentId,
        status: "completed",
      }),
    ).rejects.toThrow();
    await expect(
      otherAdmin.mutation(api.scout.lab.createThread, { experimentId }),
    ).rejects.toThrow();
  });

  it("keeps completed experiments and their threads visible", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });
    const { experimentId } = await createExperiment(admin, scoutId);
    const thread = await admin.mutation(api.scout.lab.createThread, { experimentId });

    await expect(
      admin.mutation(api.scout.lab.setExperimentStatus, {
        experimentId,
        status: "completed",
      }),
    ).resolves.toBeNull();
    await expect(admin.query(api.scout.lab.listExperiments, {})).resolves.toEqual([
      expect.objectContaining({ _id: experimentId, status: "completed" }),
    ]);
    await expect(listLabThreads(admin)).resolves.toEqual([
      expect.objectContaining({ threadId: thread.threadId, experimentId }),
    ]);
    await expect(admin.mutation(api.scout.lab.createThread, { experimentId })).rejects.toThrow();
  });

  it("lists legacy threads as ungrouped and batch assigns them idempotently", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });
    const first = await insertLegacyLabThread(backend, {
      userId,
      scoutId,
      title: "Create and publish the Tally form",
    });
    const second = await insertLegacyLabThread(backend, {
      userId,
      scoutId,
      title: "Verify the Tally response",
    });

    const legacyThreads = await listLabThreads(admin);
    expect(legacyThreads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threadId: first.threadId, experimentId: null }),
        expect.objectContaining({ threadId: second.threadId, experimentId: null }),
      ]),
    );

    const { experimentId } = await createExperiment(admin, scoutId);
    await expect(
      admin.mutation(api.scout.lab.assignThreads, {
        experimentId,
        threadIds: [first.threadId, second.threadId],
      }),
    ).resolves.toEqual({ assigned: 2 });
    await expect(
      admin.mutation(api.scout.lab.assignThreads, {
        experimentId,
        threadIds: [first.threadId, second.threadId],
      }),
    ).resolves.toEqual({ assigned: 0 });

    const assignedThreads = await listLabThreads(admin);
    expect(assignedThreads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threadId: first.threadId, experimentId }),
        expect.objectContaining({ threadId: second.threadId, experimentId }),
      ]),
    );
  });

  it("pages through Lab history beyond the first 50 threads", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const scoutId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });
    for (let index = 0; index < 51; index += 1) {
      await insertLegacyLabThread(backend, {
        userId,
        scoutId,
        title: `Historical attempt ${index + 1}`,
      });
    }

    const firstPage = await listLabThreadPage(admin);
    expect(firstPage.page).toHaveLength(50);
    expect(firstPage.isDone).toBe(false);
    const secondPage = await listLabThreadPage(admin, {
      cursor: firstPage.continueCursor,
      numItems: 50,
    });
    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.isDone).toBe(true);
  });

  it("rejects cross-experiment moves and Scout mismatches", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const conradId = await insertScout(backend, {
      firstName: "Conrad",
      lastName: "Scout",
      slug: "conrad",
    });
    const adaId = await insertScout(backend, {
      firstName: "Ada",
      lastName: "Scout",
      slug: "ada",
    });
    const thread = await insertLegacyLabThread(backend, {
      userId,
      scoutId: conradId,
      title: "Existing Tally attempt",
    });
    const firstExperiment = await createExperiment(admin, conradId);
    const secondExperiment = await createExperiment(admin, conradId);
    const otherScoutExperiment = await createExperiment(admin, adaId);
    const otherAdminId = await insertUser(backend, ADMIN_EMAIL);
    const otherAdmin = backend.withIdentity({ subject: `${otherAdminId}|other-session` });
    const otherAdminExperiment = await createExperiment(otherAdmin, conradId);

    await expect(
      otherAdmin.mutation(api.scout.lab.assignThreads, {
        experimentId: otherAdminExperiment.experimentId,
        threadIds: [thread.threadId],
      }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(api.scout.lab.assignThreads, {
        experimentId: otherAdminExperiment.experimentId,
        threadIds: [thread.threadId],
      }),
    ).rejects.toThrow();

    await expect(
      admin.mutation(api.scout.lab.assignThreads, {
        experimentId: otherScoutExperiment.experimentId,
        threadIds: [thread.threadId],
      }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(api.scout.lab.assignThreads, {
        experimentId: firstExperiment.experimentId,
        threadIds: [thread.threadId],
      }),
    ).resolves.toEqual({ assigned: 1 });
    await expect(
      admin.mutation(api.scout.lab.assignThreads, {
        experimentId: secondExperiment.experimentId,
        threadIds: [thread.threadId],
      }),
    ).rejects.toThrow();
    await expect(listLabThreads(admin)).resolves.toEqual([
      expect.objectContaining({
        threadId: thread.threadId,
        experimentId: firstExperiment.experimentId,
      }),
    ]);
  });

  it("rejects Agent threads without an application Scout binding", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const unbound = await backend.run(
      async (ctx) => await scoutAgent.createThread(ctx, { userId }),
    );

    await expect(listLabThreads(admin)).rejects.toThrow("missing its Scout binding");
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

    const created = await createLabThread(admin, scoutId);
    await expect(listLabThreads(admin)).resolves.toEqual([
      {
        threadId: created.threadId,
        creationTime: expect.any(Number),
        title: null,
        scoutId,
        experimentId: created.experimentId,
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
    await expect(listLabThreads(secondAdmin)).resolves.toEqual([]);
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
    const firstThread = await createLabThread(admin, scoutId);
    const secondThread = await createLabThread(admin, scoutId);

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
    const created = await createLabThread(admin, scoutId);
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
    const expiredGeneration = await backend.run(
      async (ctx) => await ctx.db.get("scoutLabGenerations", generation._id),
    );
    expect(expiredGeneration).toMatchObject({
      status: "failed",
      failure: "Generation stopped before completion",
    });
    expect(expiredGeneration).not.toHaveProperty("usage");

    const nextThread = await createLabThread(admin, scoutId);
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
      usage: {
        promptTokens: 123,
        completionTokens: 7,
        totalTokens: 130,
        cachedInputTokens: 100,
      },
      firecrawlCredits: 1,
      firecrawlDurationMs: 800,
    });
    const failedGeneration = await backend.run(
      async (ctx) => await ctx.db.get("scoutLabGenerations", nextGeneration._id),
    );
    expect(failedGeneration).toMatchObject({
      status: "failed",
      failure: "Provider request failed",
      usage: {
        promptTokens: 123,
        completionTokens: 7,
        totalTokens: 130,
        cachedInputTokens: 100,
      },
      firecrawlCredits: 1,
      firecrawlDurationMs: 800,
    });
    expect(failedGeneration).not.toHaveProperty("completedAt");
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
    const created = await createLabThread(admin, scoutId);

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
