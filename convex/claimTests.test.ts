/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ADMIN_EMAIL } from "./authConfig";
import { parseClaimTestOutcome } from "./claimTestRunModel";
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
type AuthenticatedTestBackend = ReturnType<TestBackend["withIdentity"]>;

const FRESH_RUN = {
  browserProfile: { kind: "fresh" as const },
  accountCreation: "not_requested" as const,
};

const ACCOUNT_EVIDENCE = {
  accountAccess: "created" as const,
  observedUrl: "https://example.test/settings/profile",
  visibleIdentity: "Signed in as conrad@example.test",
  visibleSessionControl: "Sign out",
};

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

function appliedBrowserTelemetry(afterUrl: string) {
  return {
    version: 1 as const,
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
          title: "Authenticated account",
          url: afterUrl,
          active: true,
        },
      ],
    },
    pointer: null,
  };
}

async function captureBrowserEvidence(
  backend: TestBackend,
  promptMessageId: string,
  suffix: string,
) {
  const registered = await backend.mutation(internal.claimTests.setBrowserSession, {
    promptMessageId,
    providerSessionId: `evidence-${suffix}`,
  });
  if (!registered.browserSessionId) throw new Error("Expected a browser session");
  const toolCallId = `evidence-open-${suffix}`;
  await backend.mutation(internal.claimTests.prepareBrowserOperation, {
    sessionId: registered.browserSessionId,
    toolCallId,
    action: { kind: "open", url: "https://example.test/evidence" },
  });
  await backend.mutation(internal.claimTests.settleBrowserOperation, {
    sessionId: registered.browserSessionId,
    toolCallId,
    outcome: {
      kind: "applied",
      telemetry: appliedBrowserTelemetry("https://example.test/evidence"),
    },
  });
  return registered.browserSessionId;
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

async function insertPreparedManagedAccount(
  backend: TestBackend,
  args: {
    scoutId: Id<"scouts">;
    productId: Id<"products">;
    identifier?: string;
    credentialHost?: string;
  },
) {
  return await backend.run(async (ctx) => {
    const product = await ctx.db.get("products", args.productId);
    if (!product) throw new Error("Expected a product");
    const createdAt = Date.now();
    const identifier = args.identifier ?? "conrad@example.test";
    const credentialHost = args.credentialHost ?? "accounts.example.test";
    const keyFingerprint = "test-key-fingerprint";
    const serviceAccountId = await ctx.db.insert("scoutServiceAccounts", {
      scoutId: args.scoutId,
      productId: args.productId,
      serviceName: product.name,
      serviceDomain: product.domain,
      identifier,
      authenticationEvidence: { kind: "none" },
      managedCredential: {
        kind: "managed",
        status: "prepared",
        credentialHost,
        createdAt,
      },
    });
    const configuredKey = await ctx.db
      .query("scoutCredentialKeys")
      .withIndex("by_key_version", (query) => query.eq("keyVersion", 1))
      .unique();
    if (!configuredKey) {
      await ctx.db.insert("scoutCredentialKeys", {
        keyVersion: 1,
        keyFingerprint,
        createdAt,
      });
    }
    await ctx.db.insert("scoutManagedCredentials", {
      credentialReference: crypto.randomUUID(),
      serviceAccountId,
      scoutId: args.scoutId,
      formatVersion: 1,
      algorithm: "aes-256-gcm",
      keyVersion: 1,
      keyFingerprint,
      credentialHost,
      identifier,
      nonce: "test-nonce",
      ciphertext: "test-ciphertext",
      authenticationTag: "test-authentication-tag",
      createdAt,
    });
    return serviceAccountId;
  });
}

async function startClaimTestWithBrowser(
  backend: TestBackend,
  userId: Id<"users">,
  admin: AuthenticatedTestBackend,
) {
  await insertScout(backend);
  const snapshot = await insertCompletedInvestigation(backend, {
    userId,
    claims: [claim("account creation")],
  });
  const claimKey = snapshot.claimKeys[0];
  if (!claimKey) throw new Error("Expected a claim key");
  const started = await admin.mutation(api.claimTests.start, {
    domain: "example.test",
    claimKey,
    ...FRESH_RUN,
  });
  const generation = await backend.run(async (ctx) => {
    const run = await ctx.db.get("claimTestRuns", started.runId);
    return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
  });
  if (!generation) throw new Error("Expected a claim test generation");
  const registered = await backend.mutation(internal.claimTests.setBrowserSession, {
    promptMessageId: generation.promptMessageId,
    providerSessionId: "firecrawl-session-1",
  });
  if (!registered.browserSessionId) throw new Error("Expected a claim test browser session");
  return { claimKey, started, generation, sessionId: registered.browserSessionId };
}

describe("Claim-test verdict parsing", () => {
  it("accepts only the exact required first line", () => {
    expect(parseClaimTestOutcome("Verdict: Supported\n\nDirect evidence.")).toEqual({
      verdict: "supported",
    });
    expect(parseClaimTestOutcome("Verdict: Inconclusive")).toEqual({
      verdict: "inconclusive",
    });
    expect(parseClaimTestOutcome(" Verdict: Supported")).toBeNull();
    expect(parseClaimTestOutcome("Verdict: supported")).toBeNull();
    expect(parseClaimTestOutcome("Summary\nVerdict: Supported")).toBeNull();
  });
});

describe("Claim tests", () => {
  it("keeps custom claims owner-scoped and product-scoped across investigations", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const otherUserId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const otherAdmin = backend.withIdentity({ subject: `${otherUserId}|other-session` });
    const product = await admin.mutation(api.products.create, {
      url: "example.test",
      name: "Example",
    });
    await expect(
      admin.mutation(api.products.createClaim, {
        domain: "example.test",
        claim: "A claim before research",
        suggestedMysteryShop: "",
      }),
    ).rejects.toThrow("A completed investigation is required");
    const first = await insertCompletedInvestigation(backend, {
      userId,
      productId: product.productId,
      claims: [claim("a generated workflow")],
    });
    const generatedClaimKey = first.claimKeys[0];
    if (!generatedClaimKey) throw new Error("Expected a generated claim key");

    const customClaimKey = await admin.mutation(api.products.createClaim, {
      domain: "https://www.example.test/product",
      claim: "  A workspace can be duplicated without publishing it.  ",
      suggestedMysteryShop: "  Open a private workspace and look for Duplicate.  ",
    });
    expect(customClaimKey).toMatch(/^custom-/);

    const firstProduct = await admin.query(api.products.getByDomain, {
      domain: "example.test",
    });
    const customClaim = firstProduct?.latestCompletedInvestigation?.result.claims.find(
      (candidate) => candidate.claimKey === customClaimKey,
    );
    expect(customClaim).toEqual({
      origin: "custom",
      claimKey: customClaimKey,
      claim: "A workspace can be duplicated without publishing it.",
      category: "custom",
      suggestedMysteryShop: "Open a private workspace and look for Duplicate.",
      isEdited: false,
      editedAt: null,
    });
    expect(customClaim && "sourceUrl" in customClaim).toBe(false);
    await expect(
      otherAdmin.query(api.products.getClaimByDomain, {
        domain: "example.test",
        claimKey: customClaimKey,
      }),
    ).resolves.toBeNull();
    await expect(
      otherAdmin.mutation(api.products.updateClaim, {
        domain: "example.test",
        claimKey: customClaimKey,
        claim: "Another user's edit",
        suggestedMysteryShop: "",
      }),
    ).rejects.toThrow("Claim not found");

    await expect(
      admin.mutation(api.products.updateClaim, {
        domain: "example.test",
        claimKey: customClaimKey,
        claim: "A private workspace can be duplicated.",
        suggestedMysteryShop: "   ",
      }),
    ).resolves.toMatchObject({
      origin: "custom",
      claimKey: customClaimKey,
      claim: "A private workspace can be duplicated.",
      suggestedMysteryShop: "",
      isEdited: true,
    });

    await insertCompletedInvestigation(backend, {
      userId,
      productId: first.productId,
      claims: [claim("a generated workflow")],
      suffix: "refreshed",
    });
    await expect(
      admin.query(api.products.getClaimByDomain, {
        domain: "example.test",
        claimKey: customClaimKey,
      }),
    ).resolves.toMatchObject({
      claim: {
        origin: "custom",
        claimKey: customClaimKey,
        claim: "A private workspace can be duplicated.",
      },
    });

    await expect(
      admin.mutation(api.products.removeClaim, {
        domain: "example.test",
        claimKey: customClaimKey,
      }),
    ).resolves.toBeNull();
    await expect(
      admin.query(api.products.getClaimByDomain, {
        domain: "example.test",
        claimKey: customClaimKey,
      }),
    ).resolves.toBeNull();

    await admin.mutation(api.products.removeClaim, {
      domain: "example.test",
      claimKey: generatedClaimKey,
    });
    const [ownerProduct, otherProduct] = await Promise.all([
      admin.query(api.products.getByDomain, { domain: "example.test" }),
      otherAdmin.query(api.products.getByDomain, { domain: "example.test" }),
    ]);
    expect(
      ownerProduct?.latestCompletedInvestigation?.result.claims.some(
        (candidate) => candidate.claimKey === generatedClaimKey,
      ),
    ).toBe(false);
    expect(
      otherProduct?.latestCompletedInvestigation?.result.claims.some(
        (candidate) => candidate.claimKey === generatedClaimKey,
      ),
    ).toBe(true);

    await insertCompletedInvestigation(backend, {
      userId,
      productId: first.productId,
      claims: [claim("a generated workflow")],
      suffix: "third",
    });
    const afterRefresh = await admin.query(api.products.getByDomain, { domain: "example.test" });
    expect(
      afterRefresh?.latestCompletedInvestigation?.result.claims.some(
        (candidate) => candidate.claimKey === generatedClaimKey,
      ),
    ).toBe(true);
  });

  it("keeps custom claim test status across reinvestigation and previews its exact prompt", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    await insertScout(backend);
    const first = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("research-only evidence")],
    });
    const generatedClaimKey = first.claimKeys[0];
    if (!generatedClaimKey) throw new Error("Expected a generated claim key");
    const customClaimKey = await admin.mutation(api.products.createClaim, {
      domain: "example.test",
      claim: "A visitor can compare two drafts side by side.",
      suggestedMysteryShop: "",
    });

    const [customPrompt, generatedPrompt, accountPrompt] = await Promise.all([
      admin.query(api.claimTests.promptPreview, {
        domain: "example.test",
        claimKey: customClaimKey,
        accountCreation: "not_requested",
      }),
      admin.query(api.claimTests.promptPreview, {
        domain: "example.test",
        claimKey: generatedClaimKey,
        accountCreation: "not_requested",
      }),
      admin.query(api.claimTests.promptPreview, {
        domain: "example.test",
        claimKey: customClaimKey,
        accountCreation: "required",
      }),
    ]);
    expect(customPrompt).toContain("Name: Example");
    expect(customPrompt).toContain("Domain: example.test");
    expect(customPrompt).toContain("Primary website URL: https://example.test");
    expect(customPrompt).toContain("A visitor can compare two drafts side by side.");
    expect(customPrompt).toContain("Operator instructions:\n(none provided)");
    expect(customPrompt).toContain("Never purchase anything");
    expect(customPrompt).not.toContain("UNTRUSTED RESEARCH CONTEXT");
    expect(customPrompt).not.toContain("https://example.test/features");
    expect(generatedPrompt).toContain("UNTRUSTED RESEARCH CONTEXT");
    expect(generatedPrompt).toContain("https://example.test/features");
    expect(accountPrompt).toContain("account already bound to the Run");
    expect(accountPrompt).toContain("do not pass an account identifier to the recording tool");

    const firstRun = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey: customClaimKey,
      ...FRESH_RUN,
    });
    const firstGeneration = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", firstRun.runId);
      expect(run?.claimKey).toBe(customClaimKey);
      expect(run?.testedClaim).toEqual({
        claim: "A visitor can compare two drafts side by side.",
        suggestedMysteryShop: "",
      });
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!firstGeneration) throw new Error("Expected a custom claim generation");
    await captureBrowserEvidence(backend, firstGeneration.promptMessageId, "status-refresh");
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: firstGeneration.promptMessageId,
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      claimTestOutcome: { verdict: "supported" },
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey: customClaimKey, state: "tested" });

    const second = await insertCompletedInvestigation(backend, {
      userId,
      productId: first.productId,
      claims: [claim("new research evidence")],
      suffix: "status-refresh",
    });
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: firstRun.runId,
        domain: "example.test",
        claimKey: customClaimKey,
      }),
    ).resolves.toMatchObject({
      runId: firstRun.runId,
      investigationId: first.investigationId,
      matchesCurrentClaim: true,
      generation: { status: "completed" },
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey: customClaimKey, state: "tested" });

    await admin.mutation(api.products.updateClaim, {
      domain: "example.test",
      claimKey: customClaimKey,
      claim: "A visitor can compare three drafts side by side.",
      suggestedMysteryShop: "Open the draft comparison view.",
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey: customClaimKey, state: "needs_retest" });
    const secondRun = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey: customClaimKey,
      ...FRESH_RUN,
    });
    expect(secondRun.created).toBe(true);
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey: customClaimKey, state: "testing" });
    await expect(
      backend.run(async (ctx) => {
        const run = await ctx.db.get("claimTestRuns", secondRun.runId);
        return run?.investigationId;
      }),
    ).resolves.toBe(second.investigationId);

    await admin.mutation(api.products.removeClaim, {
      domain: "example.test",
      claimKey: customClaimKey,
    });
    await expect(
      backend.run(
        async (ctx) =>
          await ctx.db
            .query("claimTestRuns")
            .withIndex("by_user_id_and_product_id_and_claim_key", (index) =>
              index
                .eq("userId", userId)
                .eq("productId", first.productId)
                .eq("claimKey", customClaimKey),
            )
            .take(3),
      ),
    ).resolves.toHaveLength(2);
  });

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
      ...FRESH_RUN,
    });

    expect(started).toMatchObject({ created: true });
    const stored = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      const generation = run
        ? await ctx.db.get("scoutLabGenerations", run.state.generationId)
        : null;
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
      browserProfile: { kind: "fresh" },
      accountCreation: "not_requested",
      state: { kind: "running" },
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
      backend.query(internal.claimTests.generationContext, {
        promptMessageId: stored.generation?.promptMessageId ?? "missing",
      }),
    ).resolves.toMatchObject({
      runId: started.runId,
      productDomain: "example.test",
      browserProfile: { kind: "fresh" },
      accountCreation: "not_requested",
    });
    await expect(
      backend.query(internal.claimTests.generationContext, {
        promptMessageId: "missing",
      }),
    ).resolves.toBeNull();
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
      ...FRESH_RUN,
    });
    const second = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      ...FRESH_RUN,
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
      ...FRESH_RUN,
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toEqual([
      { claimKey, state: "testing" },
      { claimKey: untestedClaimKey, state: "untested" },
    ]);
    const firstGeneration = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", first.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!firstGeneration) throw new Error("Expected a generation");

    await captureBrowserEvidence(backend, firstGeneration.promptMessageId, "terminal-success");
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: firstGeneration.promptMessageId,
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      claimTestOutcome: { verdict: "supported" },
      firecrawlCredits: 3,
      firecrawlDurationMs: 9_000,
    });
    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutLabExperiments", first.experimentId)),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: first.runId,
        domain: "example.test",
        claimKey,
      }),
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
      ...FRESH_RUN,
    });
    expect(second.created).toBe(true);
    expect(second.runId).not.toBe(first.runId);
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey, state: "testing" });
    const secondGeneration = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", second.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
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
      admin.query(api.claimTests.getRun, {
        runId: second.runId,
        domain: "example.test",
        claimKey,
      }),
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
      admin.mutation(api.claimTests.start, {
        domain: "example.test",
        claimKey,
        ...FRESH_RUN,
      }),
    ).resolves.toMatchObject({ created: true });
  });

  it("reuses one bound managed account across persistent-profile sessions with replay and live view", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend);
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("a continued authenticated workflow")],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");
    const serviceAccountId = await insertPreparedManagedAccount(backend, {
      scoutId,
      productId: snapshot.productId,
    });
    const runConfig = {
      browserProfile: { kind: "scout" as const, scoutId },
      accountCreation: "required" as const,
      serviceAccountId,
    };
    const started = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      ...runConfig,
    });
    const firstGeneration = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!firstGeneration) throw new Error("Expected the first generation");
    await expect(
      backend.query(internal.claimTests.generationContext, {
        promptMessageId: firstGeneration.promptMessageId,
      }),
    ).resolves.toMatchObject({ serviceAccountId });
    const firstRegistered = await backend.mutation(internal.claimTests.setBrowserSession, {
      promptMessageId: firstGeneration.promptMessageId,
      providerSessionId: "continued-session-1",
    });
    if (!firstRegistered.browserSessionId) throw new Error("Expected the first session");
    await backend.mutation(internal.claimTests.closeBrowserSessionRecord, {
      sessionId: firstRegistered.browserSessionId,
      providerDurationMs: 1_000,
      creditsBilled: 1,
    });
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: firstGeneration.promptMessageId,
      usage: { totalTokens: 10 },
      claimTestOutcome: { verdict: "inconclusive" },
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toEqual([{ claimKey, state: "inconclusive" }]);

    const continued = await admin.mutation(api.claimTests.continueRun, {
      runId: started.runId,
    });
    expect(continued.runId).toBe(started.runId);
    expect(continued.threadId).toBe(started.threadId);
    expect(continued.generationId).not.toBe(firstGeneration._id);
    const secondGeneration = await backend.run(
      async (ctx) => await ctx.db.get("scoutLabGenerations", continued.generationId),
    );
    if (!secondGeneration) throw new Error("Expected the continued generation");
    await expect(
      backend.query(internal.claimTests.generationContext, {
        promptMessageId: secondGeneration.promptMessageId,
      }),
    ).resolves.toMatchObject({ serviceAccountId });
    const secondRegistered = await backend.mutation(internal.claimTests.setBrowserSession, {
      promptMessageId: secondGeneration.promptMessageId,
      providerSessionId: "continued-session-2",
    });
    if (!secondRegistered.browserSessionId) throw new Error("Expected the second session");
    const liveViewUrl = "https://liveview.firecrawl.dev/private?signature=managed-session";
    await backend.mutation(internal.claimTests.setLiveView, {
      sessionId: secondRegistered.browserSessionId,
      liveViewUrl,
    });
    await expect(
      admin.query(api.claimTests.liveView, { sessionId: secondRegistered.browserSessionId }),
    ).resolves.toEqual({ url: liveViewUrl });
    await backend.mutation(internal.claimTests.prepareBrowserOperation, {
      sessionId: secondRegistered.browserSessionId,
      toolCallId: "continued-open",
      action: { kind: "open", url: "https://example.test/continued" },
    });
    await backend.mutation(internal.claimTests.settleBrowserOperation, {
      sessionId: secondRegistered.browserSessionId,
      toolCallId: "continued-open",
      outcome: {
        kind: "applied",
        telemetry: appliedBrowserTelemetry("https://example.test/continued"),
      },
    });

    await expect(
      admin.query(api.claimTests.listBrowserSessions, { runId: started.runId }),
    ).resolves.toMatchObject([
      {
        sessionId: firstRegistered.browserSessionId,
        generationId: firstGeneration._id,
        sequence: 1,
        profileName: "conrad-profile",
        operationCount: 0,
      },
      {
        sessionId: secondRegistered.browserSessionId,
        generationId: secondGeneration._id,
        sequence: 2,
        profileName: "conrad-profile",
        operationCount: 1,
      },
    ]);
    await expect(
      admin.query(internal.claimTests.replayData, {
        sessionId: firstRegistered.browserSessionId,
      }),
    ).resolves.toMatchObject({ providerSessionId: "continued-session-1", operations: [] });
    await expect(
      admin.query(internal.claimTests.replayData, {
        sessionId: secondRegistered.browserSessionId,
      }),
    ).resolves.toMatchObject({
      providerSessionId: "continued-session-2",
      operations: [{ toolCallId: "continued-open" }],
    });
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: started.runId,
        domain: "example.test",
        claimKey,
      }),
    ).resolves.toMatchObject({
      threadId: started.threadId,
      browserProfile: { kind: "scout", profileName: "conrad-profile" },
      state: { kind: "running", generationId: secondGeneration._id },
    });
    await expect(
      backend.run(async (ctx) =>
        ctx.db
          .query("scoutLabGenerations")
          .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", started.threadId))
          .collect(),
      ),
    ).resolves.toHaveLength(2);

    await backend.mutation(internal.claimTests.closeBrowserSessionRecord, {
      sessionId: secondRegistered.browserSessionId,
      providerDurationMs: 2_000,
      creditsBilled: 1,
    });
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: secondGeneration.promptMessageId,
      usage: { totalTokens: 20 },
      claimTestOutcome: { verdict: "inconclusive" },
    });
    const testedAgain = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      ...runConfig,
    });
    expect(testedAgain.runId).not.toBe(started.runId);
    expect(testedAgain.threadId).not.toBe(started.threadId);
    await expect(
      admin.query(api.claimTests.listRuns, { domain: "example.test", claimKey }),
    ).resolves.toHaveLength(2);
  });

  it("does not mark a completed generation tested without an exact verdict", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    await insertScout(backend);
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("an explicit verdict")],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");
    const started = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      ...FRESH_RUN,
    });
    const generation = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!generation) throw new Error("Expected a generation");
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: { totalTokens: 1 },
    });
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: started.runId,
        domain: "example.test",
        claimKey,
      }),
    ).resolves.toMatchObject({
      generation: { status: "completed" },
      state: {
        kind: "failed",
        failure: "Scout completed without an exact claim verdict",
      },
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey, state: "failed" });
  });

  it("rejects a conclusive verdict when no browser evidence was captured", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    await insertScout(backend);
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("browser-backed evidence")],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");
    const started = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      ...FRESH_RUN,
    });
    const generation = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!generation) throw new Error("Expected a generation");
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: { totalTokens: 1 },
      claimTestOutcome: { verdict: "supported" },
    });
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: started.runId,
        domain: "example.test",
        claimKey,
      }),
    ).resolves.toMatchObject({
      state: {
        kind: "failed",
        failure: "Scout returned a claim verdict without captured browser evidence",
      },
    });
  });

  it("rejects a successful required-account verdict without an authenticated account record", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend);
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("account creation")],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");
    const serviceAccountId = await insertPreparedManagedAccount(backend, {
      scoutId,
      productId: snapshot.productId,
    });
    const started = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      browserProfile: { kind: "scout", scoutId },
      accountCreation: "required",
      serviceAccountId,
    });
    const generation = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!generation) throw new Error("Expected a generation");
    await captureBrowserEvidence(backend, generation.promptMessageId, "unrecorded-account");
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: { totalTokens: 1 },
      claimTestOutcome: { verdict: "supported" },
    });
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: started.runId,
        domain: "example.test",
        claimKey,
      }),
    ).resolves.toMatchObject({
      state: {
        kind: "failed",
        failure:
          "Scout returned a successful account-creation verdict without recording authenticated account evidence",
      },
    });
  });

  it("rejects a managed account that is not owned by the selected Scout", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const selectedScoutId = await insertScout(backend, "selected");
    const otherScoutId = await insertScout(backend, "other");
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("account creation")],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");
    const otherServiceAccountId = await insertPreparedManagedAccount(backend, {
      scoutId: otherScoutId,
      productId: snapshot.productId,
      identifier: "other@example.test",
    });

    await expect(
      admin.mutation(api.claimTests.start, {
        domain: "example.test",
        claimKey,
        browserProfile: { kind: "scout", scoutId: selectedScoutId },
        accountCreation: "required",
        serviceAccountId: otherServiceAccountId,
      }),
    ).rejects.toThrow("does not match this run");
  });

  it("records only the Run-bound account with server-resolved identity evidence", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend);
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [claim("account creation")],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");
    const serviceAccountId = await insertPreparedManagedAccount(backend, {
      scoutId,
      productId: snapshot.productId,
    });
    const otherServiceAccountId = await insertPreparedManagedAccount(backend, {
      scoutId,
      productId: snapshot.productId,
      identifier: "other@example.test",
    });
    await expect(
      admin.mutation(api.claimTests.start, {
        domain: "example.test",
        claimKey,
        browserProfile: { kind: "fresh" },
        accountCreation: "required",
      }),
    ).rejects.toThrow("Account creation requires a persistent Scout browser profile");
    await expect(
      admin.mutation(api.claimTests.start, {
        domain: "example.test",
        claimKey,
        browserProfile: { kind: "scout", scoutId },
        accountCreation: "required",
      }),
    ).rejects.toThrow("requires a prepared managed service account");

    const started = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      browserProfile: { kind: "scout", scoutId },
      accountCreation: "required",
      serviceAccountId,
    });
    const generation = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!generation) throw new Error("Expected a generation");
    const registered = await backend.mutation(internal.claimTests.setBrowserSession, {
      promptMessageId: generation.promptMessageId,
      providerSessionId: "account-session",
    });
    if (!registered.browserSessionId) throw new Error("Expected an account browser session");
    await expect(
      backend.mutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
        promptMessageId: generation.promptMessageId,
        ...ACCOUNT_EVIDENCE,
      }),
    ).rejects.toThrow("successful product-page observation");
    await backend.mutation(internal.claimTests.prepareBrowserOperation, {
      sessionId: registered.browserSessionId,
      toolCallId: "account-open",
      action: { kind: "open", url: "https://example.test/account" },
    });
    await backend.mutation(internal.claimTests.settleBrowserOperation, {
      sessionId: registered.browserSessionId,
      toolCallId: "account-open",
      outcome: {
        kind: "applied",
        telemetry: appliedBrowserTelemetry("https://example.test/account"),
      },
    });
    await expect(
      backend.mutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
        promptMessageId: generation.promptMessageId,
        ...ACCOUNT_EVIDENCE,
      }),
    ).rejects.toThrow("not from the latest product page");
    await expect(
      backend.mutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
        promptMessageId: generation.promptMessageId,
        ...ACCOUNT_EVIDENCE,
        observedUrl: "https://example.test/account",
        visibleSessionControl: "Follow",
      }),
    ).rejects.toThrow("does not expose a Sign out or Log out control");
    await expect(
      backend.mutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
        promptMessageId: generation.promptMessageId,
        ...ACCOUNT_EVIDENCE,
        observedUrl: "https://example.test/account",
        visibleIdentity: "Signed in as conrad@example.test-helper",
      }),
    ).rejects.toThrow("does not contain the exact identifier");
    await expect(
      backend.mutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
        promptMessageId: generation.promptMessageId,
        ...ACCOUNT_EVIDENCE,
        observedUrl: "https://example.test/account",
        visibleSessionControl: "Sign out guide",
      }),
    ).rejects.toThrow("does not expose a Sign out or Log out control");
    await backend.mutation(internal.claimTests.prepareBrowserOperation, {
      sessionId: registered.browserSessionId,
      toolCallId: "account-identity",
      action: { kind: "navigate", url: "https://example.test/settings/profile" },
    });
    await backend.mutation(internal.claimTests.settleBrowserOperation, {
      sessionId: registered.browserSessionId,
      toolCallId: "account-identity",
      outcome: {
        kind: "applied",
        telemetry: appliedBrowserTelemetry("https://example.test/settings/profile"),
      },
    });

    const first = await backend.mutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
      promptMessageId: generation.promptMessageId,
      ...ACCOUNT_EVIDENCE,
    });
    expect(first).toEqual({ serviceAccountId, created: false });
    await expect(
      backend.mutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
        promptMessageId: generation.promptMessageId,
        ...ACCOUNT_EVIDENCE,
      }),
    ).resolves.toEqual({ serviceAccountId, created: false });
    await expect(
      backend.mutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
        promptMessageId: generation.promptMessageId,
        ...ACCOUNT_EVIDENCE,
        visibleIdentity: "Signed in as other@example.test",
      }),
    ).rejects.toThrow("does not contain the exact identifier");
    const recordedAccounts = await backend.run(async (ctx) => ({
      account: await ctx.db.get("scoutServiceAccounts", serviceAccountId),
      otherAccount: await ctx.db.get("scoutServiceAccounts", otherServiceAccountId),
      count: (await ctx.db.query("scoutServiceAccounts").collect()).length,
      run: await ctx.db.get("claimTestRuns", started.runId),
    }));
    expect(recordedAccounts).toMatchObject({
      count: 2,
      run: { serviceAccountId },
      account: {
        scoutId,
        productId: snapshot.productId,
        serviceName: "Example",
        serviceDomain: "example.test",
        identifier: "conrad@example.test",
        authenticationEvidence: { kind: "succeeded", checkedAt: expect.any(Number) },
        firstRecordedByClaimTest: {
          runId: started.runId,
          generationId: generation._id,
          sessionId: registered.browserSessionId,
          recordedAt: expect.any(Number),
          ...ACCOUNT_EVIDENCE,
        },
        lastVerifiedByClaimTest: {
          runId: started.runId,
          generationId: generation._id,
          sessionId: registered.browserSessionId,
          recordedAt: expect.any(Number),
          ...ACCOUNT_EVIDENCE,
        },
      },
      otherAccount: {
        _id: otherServiceAccountId,
        identifier: "other@example.test",
        authenticationEvidence: { kind: "none" },
      },
    });
    expect(recordedAccounts.otherAccount?.firstRecordedByClaimTest).toBeUndefined();
    expect(recordedAccounts.otherAccount?.lastVerifiedByClaimTest).toBeUndefined();
    await expect(
      admin.query(api.scout.serviceAccounts.forClaimTestRun, { runId: started.runId }),
    ).resolves.toMatchObject({
      _id: serviceAccountId,
      identifier: "conrad@example.test",
      firstRecordedByClaimTest: {
        runId: started.runId,
        accountAccess: "created",
      },
      lastVerifiedByClaimTest: {
        runId: started.runId,
        accountAccess: "created",
      },
    });
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: { totalTokens: 1 },
      claimTestOutcome: { verdict: "supported" },
    });
    const forbidden = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      ...FRESH_RUN,
    });
    const forbiddenGeneration = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", forbidden.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!forbiddenGeneration) throw new Error("Expected a forbidden generation");
    await expect(
      backend.mutation(internal.scout.serviceAccounts.upsertFromClaimTest, {
        promptMessageId: forbiddenGeneration.promptMessageId,
        ...ACCOUNT_EVIDENCE,
      }),
    ).rejects.toThrow("cannot record a created service account");
  });

  it("tests the edited claim snapshot and marks an older result as needing a retest", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    await insertScout(backend);
    const originalClaim = claim("one browser tab");
    const snapshot = await insertCompletedInvestigation(backend, {
      userId,
      claims: [originalClaim],
    });
    const claimKey = snapshot.claimKeys[0];
    if (!claimKey) throw new Error("Expected a claim key");

    const first = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      ...FRESH_RUN,
    });
    const firstGeneration = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", first.runId);
      expect(run?.testedClaim).toEqual({
        claim: originalClaim.claim,
        suggestedMysteryShop: originalClaim.suggestedMysteryShop,
      });
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!firstGeneration) throw new Error("Expected the original generation");
    await captureBrowserEvidence(backend, firstGeneration.promptMessageId, "original-claim");
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: firstGeneration.promptMessageId,
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      claimTestOutcome: { verdict: "supported" },
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toContainEqual({ claimKey, state: "tested" });

    const editedClaim = {
      claim: "The same form can remain open and usable in two tabs.",
      suggestedMysteryShop:
        "Open the form in two tabs, switch from the first tab to the second and back, and describe the visible state after each switch.",
    };
    const edited = await admin.mutation(api.products.updateClaim, {
      domain: "example.test",
      claimKey,
      ...editedClaim,
    });
    expect(edited).toMatchObject({ claimKey, ...editedClaim, isEdited: true });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toEqual([{ claimKey, state: "needs_retest" }]);
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: first.runId,
        domain: "example.test",
        claimKey,
      }),
    ).resolves.toMatchObject({
      runId: first.runId,
      matchesCurrentClaim: false,
      testedClaim: {
        claim: originalClaim.claim,
        suggestedMysteryShop: originalClaim.suggestedMysteryShop,
      },
      generation: { status: "completed" },
    });

    const second = await admin.mutation(api.claimTests.start, {
      domain: "example.test",
      claimKey,
      ...FRESH_RUN,
    });
    expect(second).toMatchObject({ created: true });
    expect(second.runId).not.toBe(first.runId);
    const secondGeneration = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", second.runId);
      expect(run?.testedClaim).toEqual(editedClaim);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!secondGeneration) throw new Error("Expected the edited generation");
    const messages = await admin.query(api.scout.lab.listMessages, {
      threadId: second.threadId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const prompt = messages.page.find((message) => message.role === "user")?.text;
    expect(prompt).toContain(editedClaim.claim);
    expect(prompt).toContain(originalClaim.sourceUrl);
    expect(prompt).toContain(editedClaim.suggestedMysteryShop);
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: second.runId,
        domain: "example.test",
        claimKey,
      }),
    ).resolves.toMatchObject({
      runId: second.runId,
      matchesCurrentClaim: true,
      testedClaim: editedClaim,
      generation: { status: "pending" },
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toEqual([{ claimKey, state: "testing" }]);

    await captureBrowserEvidence(backend, secondGeneration.promptMessageId, "edited-claim");
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: secondGeneration.promptMessageId,
      usage: { promptTokens: 80, completionTokens: 10, totalTokens: 90 },
      claimTestOutcome: { verdict: "supported" },
    });
    await expect(
      admin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toEqual([{ claimKey, state: "tested" }]);
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
      ...FRESH_RUN,
    });

    await expect(
      admin.query(api.claimTests.getRun, {
        runId: started.runId,
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
      admin.query(api.claimTests.listRuns, {
        domain: "example.test",
        claimKey: secondClaimKey,
      }),
    ).resolves.toEqual([]);

    const secondSnapshot = await insertCompletedInvestigation(backend, {
      userId,
      productId: firstSnapshot.productId,
      claims: [firstClaim],
      suffix: "two",
    });
    expect(secondSnapshot.claimKeys[0]).toBe(firstClaimKey);
    await expect(
      admin.query(api.claimTests.listRuns, {
        domain: "example.test",
        claimKey: firstClaimKey,
      }),
    ).resolves.toEqual([]);
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: started.runId,
        domain: "example.test",
        claimKey: firstClaimKey,
      }),
    ).resolves.toMatchObject({
      runId: started.runId,
      investigationId: firstSnapshot.investigationId,
      matchesCurrentClaim: true,
    });
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: started.runId,
        domain: "example.test",
        claimKey: secondClaimKey,
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
      ...FRESH_RUN,
    });
    const generation = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!generation) throw new Error("Expected a generation");

    const registered = await backend.mutation(internal.claimTests.setBrowserSession, {
      promptMessageId: generation.promptMessageId,
      providerSessionId: "firecrawl-session-1",
    });
    expect(registered).toMatchObject({ captureOperations: true });
    if (!registered.browserSessionId) throw new Error("Expected a browser session ID");
    const sessionId = registered.browserSessionId;
    await backend.mutation(internal.claimTests.prepareBrowserOperation, {
      sessionId,
      toolCallId: "tool-call-1",
      action: { kind: "click", ref: "@e1" },
    });
    await backend.mutation(internal.claimTests.settleBrowserOperation, {
      sessionId,
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
      sessionId,
      providerDurationMs: 2_000,
      creditsBilled: 1,
    });
    await expect(admin.query(internal.claimTests.replayData, { sessionId })).resolves.toMatchObject(
      {
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
      },
    );
    await expect(
      admin.query(api.claimTests.getRun, {
        runId: started.runId,
        domain: "example.test",
        claimKey,
      }),
    ).resolves.not.toHaveProperty("firecrawlSessionId");

    const otherUserId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const otherAdmin = backend.withIdentity({ subject: `${otherUserId}|other-session` });
    await expect(
      otherAdmin.query(internal.claimTests.replayData, { sessionId }),
    ).resolves.toBeNull();
    await expect(backend.query(internal.claimTests.replayData, { sessionId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      backend.mutation(internal.claimTests.setBrowserSession, {
        promptMessageId: generation.promptMessageId,
        providerSessionId: "different-session",
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
      ...FRESH_RUN,
    });
    const generation = await backend.run(async (ctx) => {
      const run = await ctx.db.get("claimTestRuns", started.runId);
      return run ? await ctx.db.get("scoutLabGenerations", run.state.generationId) : null;
    });
    if (!generation) throw new Error("Expected a generation");
    const registered = await backend.mutation(internal.claimTests.setBrowserSession, {
      promptMessageId: generation.promptMessageId,
      providerSessionId: "firecrawl-live-session",
    });
    if (!registered.browserSessionId) throw new Error("Expected a browser session ID");
    const sessionId = registered.browserSessionId;
    const liveViewUrl = "https://liveview.firecrawl.dev/private?signature=read-only";

    await backend.mutation(internal.claimTests.setLiveView, {
      sessionId,
      liveViewUrl,
    });
    await expect(admin.query(api.claimTests.liveView, { sessionId })).resolves.toEqual({
      url: liveViewUrl,
    });

    const otherUserId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const otherAdmin = backend.withIdentity({ subject: `${otherUserId}|other-session` });
    await expect(
      otherAdmin.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).resolves.toEqual([{ claimKey, state: "untested" }]);
    await expect(otherAdmin.query(api.claimTests.liveView, { sessionId })).resolves.toBeNull();
    await expect(
      backend.query(api.claimTests.listStatuses, { domain: "example.test" }),
    ).rejects.toThrow("Not authorized");
    await expect(backend.query(api.claimTests.liveView, { sessionId })).rejects.toThrow(
      "Not authorized",
    );

    await backend.mutation(internal.claimTests.clearLiveView, {
      sessionId,
    });
    await expect(admin.query(api.claimTests.liveView, { sessionId })).resolves.toBeNull();

    await backend.mutation(internal.claimTests.setLiveView, {
      sessionId,
      liveViewUrl,
    });
    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: { totalTokens: 1 },
      claimTestOutcome: { verdict: "inconclusive" },
    });
    await expect(admin.query(api.claimTests.liveView, { sessionId })).resolves.toBeNull();
    await expect(
      backend.run(async (ctx) =>
        ctx.db
          .query("claimTestLiveViews")
          .withIndex("by_generation_id", (index) => index.eq("generationId", generation._id))
          .unique(),
      ),
    ).resolves.toBeNull();
  });

  it("lets only the current run owner continue one idempotent human handoff", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const { started, generation, sessionId } = await startClaimTestWithBrowser(
      backend,
      userId,
      admin,
    );
    const interactiveLiveViewUrl =
      "https://liveview.firecrawl.dev/private?signature=interactive-control";

    const requested = await backend.mutation(internal.claimTestHumanHandoffs.request, {
      promptMessageId: generation.promptMessageId,
      reason: "  GitHub requires a CAPTCHA.  ",
      interactiveLiveViewUrl,
    });
    expect(requested).toMatchObject({
      created: true,
      recipientEmail: ADMIN_EMAIL,
      productName: "Example",
      scoutName: "Conrad Scout",
      interactiveLiveViewUrl,
    });
    const waitingHandoff = await backend.run(
      async (ctx) => await ctx.db.get("claimTestHumanHandoffs", requested.handoffId),
    );
    expect(waitingHandoff?.status).toBe("waiting");
    if (waitingHandoff?.status !== "waiting") throw new Error("Expected a waiting handoff");
    expect(waitingHandoff.expiresAt - waitingHandoff.requestedAt).toBe(5 * 60 * 1_000);
    await expect(
      backend.mutation(internal.claimTestHumanHandoffs.request, {
        promptMessageId: generation.promptMessageId,
        reason: "GitHub requires a CAPTCHA.",
        interactiveLiveViewUrl,
      }),
    ).resolves.toMatchObject({ handoffId: requested.handoffId, created: false });
    await expect(
      admin.query(api.claimTestHumanHandoffs.active, {
        sessionId,
      }),
    ).resolves.toMatchObject({
      runId: started.runId,
      reason: "GitHub requires a CAPTCHA.",
      url: interactiveLiveViewUrl,
    });

    const otherUserId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const otherAdmin = backend.withIdentity({ subject: `${otherUserId}|other-session` });
    await expect(
      otherAdmin.query(api.claimTestHumanHandoffs.active, {
        sessionId,
      }),
    ).resolves.toBeNull();
    await expect(
      otherAdmin.mutation(api.claimTestHumanHandoffs.continueHandoff, {
        handoffId: requested.handoffId,
      }),
    ).resolves.toBe(false);
    await expect(
      backend.query(api.claimTestHumanHandoffs.active, {
        sessionId,
      }),
    ).rejects.toThrow("Not authorized");
    await expect(
      backend.mutation(api.claimTestHumanHandoffs.continueHandoff, {
        handoffId: requested.handoffId,
      }),
    ).rejects.toThrow("Not authorized");

    await expect(
      admin.mutation(api.claimTestHumanHandoffs.continueHandoff, {
        handoffId: requested.handoffId,
      }),
    ).resolves.toBe(true);
    await expect(
      backend.query(internal.claimTestHumanHandoffs.getStatus, {
        handoffId: requested.handoffId,
      }),
    ).resolves.toBe("continued");
    const stored = await backend.run(
      async (ctx) => await ctx.db.get("claimTestHumanHandoffs", requested.handoffId),
    );
    expect(stored).toMatchObject({ status: "continued" });
    expect(stored).not.toHaveProperty("interactiveLiveViewUrl");
    await expect(
      backend.mutation(internal.claimTestHumanHandoffs.request, {
        promptMessageId: generation.promptMessageId,
        reason: "A second request",
        interactiveLiveViewUrl,
      }),
    ).rejects.toThrow("already ended");
  });

  it("does not continue a human handoff after its deadline", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const { generation } = await startClaimTestWithBrowser(backend, userId, admin);
    const requested = await backend.mutation(internal.claimTestHumanHandoffs.request, {
      promptMessageId: generation.promptMessageId,
      reason: "A CAPTCHA blocks the account form.",
      interactiveLiveViewUrl:
        "https://liveview.firecrawl.dev/private?signature=interactive-control",
    });
    await backend.run(async (ctx) => {
      const handoff = await ctx.db.get("claimTestHumanHandoffs", requested.handoffId);
      if (!handoff || handoff.status !== "waiting") throw new Error("Expected a waiting handoff");
      await ctx.db.patch("claimTestHumanHandoffs", handoff._id, { expiresAt: Date.now() - 1 });
    });

    await expect(
      admin.mutation(api.claimTestHumanHandoffs.continueHandoff, {
        handoffId: requested.handoffId,
      }),
    ).resolves.toBe(false);
    await expect(
      backend.query(internal.claimTestHumanHandoffs.getStatus, {
        handoffId: requested.handoffId,
      }),
    ).resolves.toBe("expired");
  });

  it("removes the interactive takeover secret when the generation completes", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const { generation, sessionId } = await startClaimTestWithBrowser(backend, userId, admin);
    const requested = await backend.mutation(internal.claimTestHumanHandoffs.request, {
      promptMessageId: generation.promptMessageId,
      reason: "A CAPTCHA blocks the account form.",
      interactiveLiveViewUrl:
        "https://liveview.firecrawl.dev/private?signature=interactive-control",
    });

    await backend.mutation(internal.scout.lab.completeGeneration, {
      promptMessageId: generation.promptMessageId,
      usage: { totalTokens: 1 },
      claimTestOutcome: { verdict: "inconclusive" },
    });

    const stored = await backend.run(
      async (ctx) => await ctx.db.get("claimTestHumanHandoffs", requested.handoffId),
    );
    expect(stored).toMatchObject({ status: "expired" });
    expect(stored).not.toHaveProperty("interactiveLiveViewUrl");
    await expect(
      admin.query(api.claimTestHumanHandoffs.active, {
        sessionId,
      }),
    ).resolves.toBeNull();
  });

  it("removes the interactive takeover secret when the request times out", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const { generation } = await startClaimTestWithBrowser(backend, userId, admin);
    const requested = await backend.mutation(internal.claimTestHumanHandoffs.request, {
      promptMessageId: generation.promptMessageId,
      reason: "A CAPTCHA blocks the account form.",
      interactiveLiveViewUrl:
        "https://liveview.firecrawl.dev/private?signature=interactive-control",
    });

    await backend.mutation(internal.claimTestHumanHandoffs.expire, {
      handoffId: requested.handoffId,
    });

    const stored = await backend.run(
      async (ctx) => await ctx.db.get("claimTestHumanHandoffs", requested.handoffId),
    );
    expect(stored).toMatchObject({ status: "expired" });
    expect(stored).not.toHaveProperty("interactiveLiveViewUrl");
  });
});
