/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ADMIN_EMAIL } from "./authConfig";
import { projectClaims } from "./productsClaims";
import type { ProductInvestigationResult } from "./productsValidation";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function testBackend() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  return backend;
}

type TestBackend = ReturnType<typeof testBackend>;

async function authenticatedBackend() {
  const backend = testBackend();
  const userId = await backend.run(
    async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
  );
  return {
    backend,
    userId,
    admin: backend.withIdentity({ subject: `${userId}|test-session` }),
  };
}

async function insertScout(backend: TestBackend, slug = "conrad") {
  return await backend.run(
    async (ctx) =>
      await ctx.db.insert("scouts", {
        displayName: "Conrad Scout",
        websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
        slug,
        status: "active",
        agentMail: {
          inboxId: `${slug}-inbox`,
          address: `${slug}@example.test`,
        },
        firecrawl: { profileName: `${slug}-profile` },
      }),
  );
}

function claim(label: string): ProductInvestigationResult["claims"][number] {
  return {
    claim: `Example promises ${label}.`,
    category: "capability",
    sourceUrl: "https://example.test/features",
    support: `The product page describes ${label}.`,
    suggestedMysteryShop: `Use the product once and verify that ${label} is visible.`,
    qualifiers: ["A free account may be required."],
    evidenceExcerpt: `Get ${label}.`,
    pageTitle: "Example features",
  };
}

function investigationResult(
  claims: ProductInvestigationResult["claims"],
): ProductInvestigationResult {
  return {
    summary: "Example describes a testable workflow.",
    audiences: ["Researchers"],
    claims,
    dependencies: [],
    tensions: [],
    access: {
      signupState: "open",
      freeEntry: "yes",
      paymentMethodRequired: "no",
      requirements: [],
    },
    unknowns: [],
    sources: [{ url: "https://example.test/features", title: "Example features" }],
  };
}

async function insertCompletedInvestigation(
  backend: TestBackend,
  args: {
    userId: Id<"users">;
    productId?: Id<"products">;
    claims: ProductInvestigationResult["claims"];
    suffix?: string;
  },
) {
  return await backend.run(async (ctx) => {
    const productId =
      args.productId ??
      (await ctx.db.insert("products", {
        name: "Example",
        domain: "example.test",
        primaryUrl: "https://example.test",
      }));
    const now = Date.now();
    const investigationId = await ctx.db.insert("productInvestigations", {
      productId,
      requestedByUserId: args.userId,
      requestedAt: now - 2_000,
      provider: "firecrawl-convex",
      requestedModel: "openai/gpt-5.6-luna",
      effort: "medium",
      maxCredits: 9,
      agentThreadId: `research-${args.suffix ?? "one"}`,
      status: "completed",
      startedAt: now - 1_500,
      completedAt: now - 1_000,
      retrieval: {
        mapCredits: 1,
        searchCredits: 0,
        scrapeCredits: 1,
        totalCredits: 2,
        mapCandidateCount: 2,
        selectedPageCount: 1,
        scrapedPageCount: 1,
      },
      result: investigationResult(args.claims),
    });
    await ctx.db.patch("products", productId, {
      latestInvestigationId: investigationId,
      latestCompletedInvestigationId: investigationId,
    });
    return {
      productId,
      investigationId,
      claimKeys: projectClaims(args.claims).map((item) => item.claimKey),
    };
  });
}

describe("Claim tests", () => {
  it("starts one linked Lab generation with a bounded verification prompt", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend);
    const testClaim = claim("an export after one click");
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [testClaim],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");

    const started = await admin.mutation(api.claimTests.start, {
      domain: "https://WWW.EXAMPLE.test/products",
      claimKey,
    });

    expect(started).toMatchObject({ created: true });
    const stored = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      const generation = run ? await ctx.db.get("scoutLabGenerations", run.generationId) : null;
      const experiment = run ? await ctx.db.get("scoutLabExperiments", run.experimentId) : null;
      const thread = run
        ? await ctx.db
            .query("scoutLabThreads")
            .withIndex("by_thread_id", (index) => index.eq("threadId", run.threadId))
            .unique()
        : null;
      return { run, generation, experiment, thread };
    });
    expect(stored.run).toMatchObject({
      userId,
      productId: snapshot.productId,
      investigationId: snapshot.investigationId,
      claimKey,
      scoutId,
      experimentId: started.experimentId,
      threadId: started.threadId,
    });
    expect(stored.generation).toMatchObject({
      status: "pending",
      scoutId,
      model: "qwen/qwen3.7-flash",
    });
    expect(stored.experiment).toMatchObject({
      status: "active",
      productId: snapshot.productId,
      scoutId,
    });
    expect(stored.thread).toMatchObject({
      threadId: started.threadId,
      experimentId: started.experimentId,
      scoutId,
    });

    const messages = await admin.query(api.scout.lab.listMessages, {
      threadId: started.threadId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const prompt = messages.page.find((message) => message.role === "user")?.text;
    expect(prompt).toContain("It is not proof");
    expect(prompt).toContain("Verdict: Supported");
    expect(prompt).toContain("exact visible wording");
    expect(prompt).toContain("configured Scout identity");
    expect(prompt).toContain("Never purchase anything");
    expect(prompt).toContain("Begin the final response with exactly one line");
    expect(prompt).toContain("Close the browser");
    await expect(
      backend.query(internal.claimTests.isClaimTestGeneration, {
        promptMessageId: stored.generation?.promptMessageId ?? "missing",
      }),
    ).resolves.toBe(true);
    await expect(
      backend.query(internal.claimTests.isClaimTestGeneration, {
        promptMessageId: "missing",
      }),
    ).resolves.toBe(false);
  });

  it("returns the same run while its exact claim generation is pending", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    await insertScout(backend);
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("a searchable library")],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");

    const first = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
    });
    const second = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
    });

    expect(second).toEqual({ ...first, created: false });
    await expect(
      backend.run(
        async (ctx) =>
          await ctx.db
            .query("claimTestRuns")
            .withIndex("by_user_id_and_product_id_and_investigation_id_and_claim_key", (index) =>
              index
                .eq("userId", userId)
                .eq("productId", snapshot.productId)
                .eq("investigationId", snapshot.investigationId)
                .eq("claimKey", claimKey),
            )
            .take(2),
      ),
    ).resolves.toHaveLength(1);
  });

  it("returns reactive generation metadata and permits retries after terminal states", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    await insertScout(backend);
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("a browser-readable result"), claim("an untested export")],
    });
    const claimKey = snapshot.claimKeys[0];
    const untestedClaimKey = snapshot.claimKeys[1];
    if (!claimKey || !untestedClaimKey) throw new Error("Expected claim keys");
    const first = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toEqual([
      { claimKey, state: "testing" },
      { claimKey: untestedClaimKey, state: "untested" },
    ]);
    const firstGeneration = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", first.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.generationId) : null;
    });
    if (!firstGeneration) throw new Error("Expected a generation");

    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: firstGeneration.promptMessageId,
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      firecrawlCredits: 3,
      firecrawlDurationMs: 9_000,
    });
    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutLabExperiments", first.experimentId)),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(
      admin.query(api.claimTests.latest, { domain: "example.test", claimKey }),
    ).resolves.toMatchObject({
      runId: first.runId,
      generation: {
        status: "completed",
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        firecrawlCredits: 3,
        firecrawlDurationMs: 9_000,
      },
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey, state: "tested" });

    const second = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
    });
    expect(second.created).toBe(true);
    expect(second.runId).not.toBe(first.runId);
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey, state: "testing" });
    const secondGeneration = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", second.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.generationId) : null;
    });
    if (!secondGeneration) throw new Error("Expected a retry generation");
    await backend.mutation(internal.scout.lab.failGeneration, {
      promptMessageId: secondGeneration.promptMessageId,
      failure: "Browser session failed",
      firecrawlCredits: 1,
    });
    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutLabExperiments", second.experimentId)),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(
      admin.query(api.claimTests.latest, { domain: "example.test", claimKey }),
    ).resolves.toMatchObject({
      runId: second.runId,
      generation: {
        status: "failed",
        failure: "Browser session failed",
        firecrawlCredits: 1,
      },
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey, state: "failed" });
    await expect(
      admin.mutation(api.claimTests.start, { domain: "example.test", claimKey }),
    ).resolves.toMatchObject({ created: true });
  });

  it("links lookup to both the exact claim and the current investigation snapshot", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    await insertScout(backend);
    const firstClaim = claim("the first behavior");
    const secondClaim = claim("the second behavior");
    const firstSnapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [firstClaim, secondClaim],
    });
    const firstClaimKey = firstSnapshot.claimKeys[0];
    const secondClaimKey = firstSnapshot.claimKeys[1];
    if (!firstClaimKey || !secondClaimKey) throw new Error("Expected claim keys");
    const started = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey: firstClaimKey,
    });

    await expect(
      admin.query(api.claimTests.latest, {
        domain: "example.test",
        claimKey: firstClaimKey,
      }),
    ).resolves.toMatchObject({
      runId: started.runId,
      investigationId: firstSnapshot.investigationId,
      claimKey: firstClaimKey,
      scout: { displayName: "Conrad Scout" },
      generation: { status: "pending" },
    });
    await expect(
      admin.query(api.claimTests.latest, {
        domain: "example.test",
        claimKey: secondClaimKey,
      }),
    ).resolves.toBeNull();

    const secondSnapshot = await insertCompletedInvestigation(backend, {
      userId,
      productId: firstSnapshot.productId,
      claims: [firstClaim],
      suffix: "two",
    });
    expect(secondSnapshot.claimKeys[0]).toBe(firstClaimKey);
    await expect(
      admin.query(api.claimTests.latest, {
        domain: "example.test",
        claimKey: firstClaimKey,
      }),
    ).resolves.toBeNull();
  });

  it("keeps browser evidence private and bound to one exact run", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    await insertScout(backend);
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("a recorded browser session")],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");
    const started = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
    });
    const generation = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.generationId) : null;
    });
    if (!generation) throw new Error("Expected a generation");

    await expect(
      backend.mutation(internal.claimTests.setBrowserSession, {
        promptMessageId: generation.promptMessageId,
        sessionId: "firecrawl-session-1",
      }),
    ).resolves.toEqual({ captureOperations: true });
    await backend.mutation(internal.claimTests.prepareBrowserOperation, {
      promptMessageId: generation.promptMessageId,
      toolCallId: "tool-call-1",
      action: { kind: "click", ref: "@e1" },
    });
    await backend.mutation(internal.claimTests.settleBrowserOperation, {
      promptMessageId: generation.promptMessageId,
      toolCallId: "tool-call-1",
      outcome: {
        kind: "applied",
        telemetry: {
          version: 1,
          before: {
            capturedAtMs: 1_000,
            tabs: [
              {
                tabId: "t1",
                title: "Example",
                url: "https://example.test/",
                active: true,
              },
            ],
          },
          dispatchedAtMs: 1_010,
          returnedAtMs: 1_020,
          after: {
            capturedAtMs: 1_020,
            tabs: [
              {
                tabId: "t1",
                title: "Example account",
                url: "https://example.test/account",
                active: true,
              },
            ],
          },
          pointer: {
            tabId: "t1",
            ref: "@e1",
            box: { x: 10, y: 20, width: 80, height: 40 },
          },
        },
      },
    });
    await backend.mutation(internal.claimTests.closeBrowserSessionRecord, {
      promptMessageId: generation.promptMessageId,
      providerDurationMs: 2_000,
      creditsBilled: 1,
    });
    await expect(
      admin.query(internal.claimTests.replayData, { runId: started.runId }),
    ).resolves.toMatchObject({
      providerSessionId: "firecrawl-session-1",
      viewport: { width: 1_280, height: 800 },
      lifecycle: { kind: "closed", providerDurationMs: 2_000, creditsBilled: 1 },
      operations: [
        {
          sequence: 1,
          toolCallId: "tool-call-1",
          action: { kind: "click", ref: "@e1" },
          state: { kind: "applied" },
        },
      ],
    });
    await expect(
      admin.query(api.claimTests.latest, { domain: "example.test", claimKey }),
    ).resolves.not.toHaveProperty("firecrawlSessionId");

    const otherUserId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const otherAdmin = backend.withIdentity({ subject: `${otherUserId}|other-session` });
    await expect(
      otherAdmin.query(internal.claimTests.replayData, { runId: started.runId }),
    ).resolves.toBeNull();
    await expect(
      backend.query(internal.claimTests.replayData, { runId: started.runId }),
    ).rejects.toThrow("Not authorized");
    await expect(
      backend.mutation(internal.claimTests.setBrowserSession, {
        promptMessageId: generation.promptMessageId,
        sessionId: "different-session",
      }),
    ).rejects.toThrow("different Firecrawl browser session");
  });

  it("exposes a pending live view only to its owner and removes it on close or terminal state", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    await insertScout(backend);
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("a visible browser session")],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");
    const started = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
    });
    const generation = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.generationId) : null;
    });
    if (!generation) throw new Error("Expected a generation");
    const liveViewUrl = "https://liveview.firecrawl.dev/private?signature=read-only";

    await backend.mutation(internal.claimTests.setLiveView, {
      promptMessageId: generation.promptMessageId,
      liveViewUrl,
    });
    await expect(
      admin.query(api.claimTests.liveView, { domain: "example.test", claimKey }),
    ).resolves.toEqual({ url: liveViewUrl });

    const otherUserId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const otherAdmin = backend.withIdentity({ subject: `${otherUserId}|other-session` });
    await expect(
      otherAdmin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toEqual([{ claimKey, state: "untested" }]);
    await expect(
      otherAdmin.query(api.claimTests.liveView, { domain: "example.test", claimKey }),
    ).resolves.toBeNull();
    await expect(
      backend.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).rejects.toThrow("Not authorized");
    await expect(
      backend.query(api.claimTests.liveView, { domain: "example.test", claimKey }),
    ).rejects.toThrow("Not authorized");

    await backend.mutation(internal.claimTests.clearLiveView, {
      promptMessageId: generation.promptMessageId,
    });
    await expect(
      admin.query(api.claimTests.liveView, { domain: "example.test", claimKey }),
    ).resolves.toBeNull();

    await backend.mutation(internal.claimTests.setLiveView, {
      promptMessageId: generation.promptMessageId,
      liveViewUrl,
    });
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: { totalTokens: 1 },
    });
    await expect(
      admin.query(api.claimTests.liveView, { domain: "example.test", claimKey }),
    ).resolves.toBeNull();
    await expect(
      backend.run(async (ctx) =>
        ctx.db
          .query("claimTestLiveViews")
          .withIndex("by_generation_id", (index) => index.eq("generationId", generation._id))
          .unique(),
      ),
    ).resolves.toBeNull();
  });
});
