/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ADMIN_EMAIL } from "./authConfig";
import {
  MAX_RESEARCH_FIRECRAWL_CREDITS,
  MAX_RESEARCH_PAGE_CHARACTERS,
  MAX_RESEARCH_PAGES,
  MAX_RESEARCH_PROMPT_CHARACTERS,
  MAX_RESEARCH_SYNTHESIS_TEXT_CHARACTERS,
  type PackedResearchPage,
  buildProductResearchPrompt,
  createProductRetrievalMetadata,
  hasAdequateResearchCoverage,
  hydrateProductResearchResult,
  normalizeFirstPartyResearchUrl,
  parseFirecrawlMapResponse,
  parseFirecrawlScrapeResponse,
  parseFirecrawlSearchResponse,
  parseProductResearchSynthesis,
  parseProductResearchSynthesisText,
  requireUsableResearchPages,
  selectResearchCandidates,
} from "./productsResearch";
import type { ProductInvestigationResult } from "./productsValidation";
import { parseProductInvestigationResult } from "./productsValidation";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW = new Date("2026-08-29T12:00:00.000Z");

function testBackend() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  workflowTest.register(backend);
  return backend;
}

type TestBackend = ReturnType<typeof testBackend>;
type AuthenticatedTestBackend = ReturnType<TestBackend["withIdentity"]>;

type SyncCursor =
  | { phase: "accounts"; cursor: string | null }
  | { phase: "experiments"; cursor: string | null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function insertUser(backend: TestBackend, email: string) {
  return await backend.run(async (ctx) => await ctx.db.insert("users", { email }));
}

async function authenticatedBackend() {
  const backend = testBackend();
  const userId = await insertUser(backend, ADMIN_EMAIL);
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
        displayName: `${slug.charAt(0).toUpperCase()}${slug.slice(1)} Scout`,
        websiteIdentity: { firstName: slug, lastName: "Scout" },
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

function validClaim(): ProductInvestigationResult["claims"][number] {
  return {
    claim: "Example says teams can publish a workspace in minutes.",
    category: "capability",
    sourceUrl: "https://www.example.test/features#publish",
    support: "The features page describes an assisted publishing workflow.",
    suggestedMysteryShop: "Create a workspace and measure time to a public URL.",
    qualifiers: ["Timing excludes account approval."],
    evidenceExcerpt: "Publish your workspace in minutes.",
    pageTitle: "Example features",
  };
}

function validAccess(): ProductInvestigationResult["access"] {
  return {
    signupState: "open",
    freeEntry: "trial",
    paymentMethodRequired: "no",
    requirements: ["Work email"],
  };
}

function validInvestigationResult(): ProductInvestigationResult {
  return {
    summary: "Example presents a collaborative publishing product.",
    audiences: ["Product teams"],
    claims: [validClaim()],
    dependencies: [
      {
        name: "Example identity",
        relationship: "Accounts use the product's first-party identity service.",
        sourceUrl: "https://docs.example.test/getting-started#account",
      },
    ],
    tensions: [
      {
        summary: "The headline omits an approval qualifier shown lower on the same page.",
        evidence: [
          {
            sourceUrl: "https://www.example.test/features#headline",
            evidenceExcerpt: "Publish in minutes.",
            pageTitle: "Example features",
          },
          {
            sourceUrl: "https://www.example.test/features#qualifier",
            evidenceExcerpt: "Publication may require review.",
            pageTitle: "Example features",
          },
        ],
      },
    ],
    access: validAccess(),
    unknowns: ["Whether review time is included in the headline timing."],
    sources: [
      {
        url: "https://www.example.test/features#overview",
        title: "Example features",
      },
      {
        url: "https://docs.example.test/getting-started#account",
        title: "Getting started",
      },
    ],
  };
}

function validRetrievalMetadata() {
  return createProductRetrievalMetadata({
    searchCredits: 0,
    mapCandidateCount: 5,
    selectedPageCount: 2,
    scrapedPageCount: 2,
    scrapeCredits: 2,
  });
}

function validSynthesis(sourceId = "S1") {
  return {
    summary: "Example presents a collaborative publishing product.",
    audiences: ["Product teams"],
    claims: [
      {
        claim: "Example says teams can publish a workspace in minutes.",
        category: "capability",
        sourceId,
        support: "The page describes an assisted publishing workflow.",
        suggestedMysteryShop: "Create a workspace and measure time to a public URL.",
        qualifiers: ["Timing excludes account approval."],
        evidenceExcerpt: "Publish your workspace in minutes.",
      },
    ],
    dependencies: [],
    tensions: [],
    access: validAccess(),
    unknowns: ["Whether review time is included."],
  };
}

function researchPage(sourceId: string, url = "https://example.test/features"): PackedResearchPage {
  return {
    sourceId,
    url,
    title: "Example features",
    markdown: "Publish your workspace in minutes. Publication may require review.",
  };
}

async function drainProductSync(admin: AuthenticatedTestBackend, initialCursor: SyncCursor | null) {
  let cursor = initialCursor;
  for (let index = 0; index < 10; index += 1) {
    if (!cursor) return;
    const result = await admin.mutation(api.products.syncKnownProducts, {
      continuation: cursor,
    });
    cursor = result.next;
  }
  throw new Error("Product sync did not finish within ten bounded batches");
}

function requireLinkedProductId(row: { productId?: Id<"products"> }) {
  if (!row.productId) {
    throw new Error("Expected a legacy row to be linked to a Product");
  }
  return row.productId;
}

async function onlyProduct(client: AuthenticatedTestBackend) {
  const products = await client.query(api.products.list, {});
  expect(products).toHaveLength(1);
  const product = products[0];
  if (!product) {
    throw new Error("Expected one Product");
  }
  return product;
}

describe("Products registry", () => {
  it("rejects unauthenticated and non-admin product operations", async () => {
    const backend = testBackend();
    const productId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("products", {
          name: "Example",
          domain: "example.test",
          primaryUrl: "https://example.test",
        }),
    );
    const createArgs = { url: "example.test", name: "Example" };

    await expect(backend.query(api.products.list, {})).rejects.toThrow("Not authorized");
    await expect(backend.mutation(api.products.create, createArgs)).rejects.toThrow(
      "Not authorized",
    );
    await expect(backend.mutation(api.products.syncKnownProducts, {})).rejects.toThrow(
      "Not authorized",
    );
    await expect(backend.mutation(api.products.startInvestigation, { productId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(backend.mutation(api.products.resetResearch, { productId })).rejects.toThrow(
      "Not authorized",
    );

    const nonAdminId = await insertUser(backend, "person@example.test");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(nonAdmin.query(api.products.list, {})).rejects.toThrow("Not authorized");
    await expect(nonAdmin.mutation(api.products.create, createArgs)).rejects.toThrow(
      "Not authorized",
    );
    await expect(nonAdmin.mutation(api.products.syncKnownProducts, {})).rejects.toThrow(
      "Not authorized",
    );
    await expect(nonAdmin.mutation(api.products.startInvestigation, { productId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(nonAdmin.mutation(api.products.resetResearch, { productId })).rejects.toThrow(
      "Not authorized",
    );
  });

  it("canonicalizes domains and deduplicates leading www hosts with arbitrary paths", async () => {
    const { admin } = await authenticatedBackend();
    const first = await admin.mutation(api.products.create, {
      url: "  https://WWW.Example.TEST/marketing/claims?campaign=launch#hero  ",
      name: "  Example Product  ",
    });
    const second = await admin.mutation(api.products.create, {
      url: "example.test/pricing",
      name: "A duplicate name",
    });
    const third = await admin.mutation(api.products.create, {
      url: "http://www.example.test/docs/getting-started",
    });

    expect(first.created).toBe(true);
    expect(second).toEqual({ productId: first.productId, created: false });
    expect(third).toEqual({ productId: first.productId, created: false });
    await expect(admin.query(api.products.list, {})).resolves.toMatchObject([
      {
        _id: first.productId,
        name: "Example Product",
        domain: "example.test",
        primaryUrl: "https://example.test",
      },
    ]);
  });

  it("links structured service-account and Lab experiment creation to one Product", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend);
    const account = await admin.mutation(api.scout.serviceAccounts.register, {
      scoutId,
      serviceName: "Tally",
      serviceDomain: "https://www.tally.so/forms/example",
      identifier: "conrad@example.test",
    });
    const experiment = await admin.mutation(api.scout.lab.createExperiment, {
      name: "Tally form lifecycle",
      scoutId,
      targetProduct: "Tally Forms",
      targetDomain: "TALLY.SO/features/forms",
      objective: "Check whether the advertised form lifecycle works.",
    });

    const links = await backend.run(async (ctx) => ({
      account: await ctx.db.get("scoutServiceAccounts", account.serviceAccountId),
      experiment: await ctx.db.get("scoutLabExperiments", experiment.experimentId),
      products: await ctx.db.query("products").withIndex("by_domain").collect(),
    }));
    expect(links.products).toHaveLength(1);
    expect(links.account?.productId).toBe(links.products[0]?._id);
    expect(links.experiment?.productId).toBe(links.products[0]?._id);

    await expect(admin.query(api.products.list, {})).resolves.toMatchObject([
      {
        name: "Tally",
        domain: "tally.so",
        experimentCount: 1,
        scoutAccess: [
          {
            scoutId,
            displayName: "Conrad Scout",
            accountCount: 1,
            authenticationEvidence: "none",
          },
        ],
      },
    ]);
  });

  it("syncs legacy rows in bounded pages and remains idempotent", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend);
    await backend.run(async (ctx) => {
      for (let index = 0; index < 26; index += 1) {
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId,
          serviceName: `Legacy ${index}`,
          serviceDomain: `www.legacy-${index}.example/path`,
          identifier: `legacy-${index}@example.test`,
          authenticationEvidence: { kind: "none" },
        });
        await ctx.db.insert("scoutLabExperiments", {
          userId,
          scoutId,
          name: `Legacy experiment ${index}`,
          targetProduct: `Legacy ${index}`,
          targetDomain: `https://LEGACY-${index}.EXAMPLE/another/path`,
          objective: "Preserve this historical experiment.",
          status: "completed",
        });
      }
    });

    const firstSync = await admin.mutation(api.products.syncKnownProducts, {});
    expect(firstSync).toMatchObject({
      accountsLinked: 25,
      experimentsLinked: 0,
      skipped: 0,
      next: { phase: "accounts" },
    });
    const firstBatch = await backend.run(async (ctx) => ({
      accounts: await ctx.db.query("scoutServiceAccounts").collect(),
      experiments: await ctx.db.query("scoutLabExperiments").collect(),
      products: await ctx.db.query("products").collect(),
    }));
    expect(firstBatch.accounts.filter((account) => account.productId !== undefined)).toHaveLength(
      25,
    );
    expect(
      firstBatch.experiments.filter((experiment) => experiment.productId !== undefined),
    ).toHaveLength(0);
    expect(firstBatch.products).toHaveLength(25);

    await drainProductSync(admin, firstSync.next);
    const completed = await backend.run(async (ctx) => ({
      accounts: await ctx.db.query("scoutServiceAccounts").collect(),
      experiments: await ctx.db.query("scoutLabExperiments").collect(),
      products: await ctx.db.query("products").collect(),
    }));
    const accountProductIds = completed.accounts.map(requireLinkedProductId);
    const experimentProductIds = completed.experiments.map(requireLinkedProductId);
    expect(completed.products).toHaveLength(26);
    expect(new Set(accountProductIds)).toEqual(new Set(experimentProductIds));

    const repeatedSync = await admin.mutation(api.products.syncKnownProducts, {});
    expect(repeatedSync).toMatchObject({
      accountsLinked: 0,
      experimentsLinked: 0,
      skipped: 0,
      next: { phase: "accounts" },
    });
    await drainProductSync(admin, repeatedSync.next);
    const repeated = await backend.run(async (ctx) => ({
      accounts: await ctx.db.query("scoutServiceAccounts").collect(),
      experiments: await ctx.db.query("scoutLabExperiments").collect(),
      products: await ctx.db.query("products").collect(),
    }));
    expect(repeated.products.map((product) => product._id)).toEqual(
      completed.products.map((product) => product._id),
    );
    expect(repeated.accounts.map(requireLinkedProductId)).toEqual(accountProductIds);
    expect(repeated.experiments.map(requireLinkedProductId)).toEqual(experimentProductIds);
  });
});

describe("Product investigations", () => {
  it("returns one current-family queued investigation for a double-click", async () => {
    const { backend, admin } = await authenticatedBackend();
    const { productId } = await admin.mutation(api.products.create, {
      url: "example.test",
      name: "Example",
    });

    const first = await admin.mutation(api.products.startInvestigation, { productId });
    const second = await admin.mutation(api.products.startInvestigation, { productId });

    expect(first.created).toBe(true);
    expect(second).toEqual({ investigationId: first.investigationId, created: false });
    const records = await backend.run(async (ctx) => ({
      investigations: await ctx.db.query("productInvestigations").collect(),
      legacyScheduled: (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name === "productsInvestigation:run" && job.state.kind === "pending",
      ),
    }));
    expect(records.investigations).toHaveLength(1);
    expect(records.investigations[0]).toMatchObject({
      _id: first.investigationId,
      productId,
      provider: "firecrawl-convex",
      requestedModel: "openai/gpt-5.6-luna",
      maxCredits: 9,
      agentThreadId: expect.any(String),
      workflowId: expect.any(String),
      status: "queued",
    });
    expect(records.legacyScheduled).toHaveLength(0);
  });

  it("keeps the workflow inspector authenticated and returns only the recorded request envelope", async () => {
    const { backend, admin } = await authenticatedBackend();
    const { productId } = await admin.mutation(api.products.create, {
      url: "example.test",
      name: "Example",
    });
    const { investigationId } = await admin.mutation(api.products.startInvestigation, {
      productId,
    });

    await expect(
      backend.query(api.productsInvestigationInspector.get, { investigationId }),
    ).rejects.toThrow();

    const started = await backend.mutation(internal.products.markProductResearchRunning, {
      investigationId,
      durableWorkflow: true,
    });
    expect(started).not.toBeNull();
    if (started === null) throw new Error("Expected the investigation to start");

    const attempt = await backend.mutation(internal.productsInvestigationActivities.start, {
      investigationId,
      investigationStartedAt: started.startedAt,
      key: "firecrawl_map",
      sequence: 10,
      actor: "Firecrawl",
      operation: "POST /v2/map",
      source: {
        kind: "external",
        request: {
          method: "POST",
          url: "https://api.firecrawl.dev/v2/map",
          body: '{\n  "url": "https://example.test",\n  "limit": 50\n}',
        },
      },
    });
    expect(attempt).toBe(1);
    if (attempt === null) throw new Error("Expected the activity to start");
    await backend.mutation(internal.productsInvestigationActivities.complete, {
      investigationId,
      investigationStartedAt: started.startedAt,
      key: "firecrawl_map",
      attempt,
      metrics: [
        { label: "Eligible first-party URLs", value: "11" },
        { label: "Firecrawl credits", value: "1" },
      ],
    });

    const inspector = await admin.query(api.productsInvestigationInspector.get, {
      investigationId,
    });
    expect(inspector).toMatchObject({
      investigationId,
      state: "running",
      activities: [
        {
          key: "firecrawl_map",
          actor: "Firecrawl",
          operation: "POST /v2/map",
          source: {
            kind: "external",
            request: {
              method: "POST",
              url: "https://api.firecrawl.dev/v2/map",
              body: '{\n  "url": "https://example.test",\n  "limit": 50\n}',
            },
          },
          lifecycle: {
            status: "completed",
            metrics: [
              { label: "Eligible first-party URLs", value: "11" },
              { label: "Firecrawl credits", value: "1" },
            ],
          },
        },
      ],
    });
    const serialized = JSON.stringify(inspector);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("markdown");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("returnValue");
  });

  it("closes a running provider activity when its investigation fails", async () => {
    const { backend, admin } = await authenticatedBackend();
    const { productId } = await admin.mutation(api.products.create, {
      url: "example.test",
      name: "Example",
    });
    const { investigationId } = await admin.mutation(api.products.startInvestigation, {
      productId,
    });
    const started = await backend.mutation(internal.products.markProductResearchRunning, {
      investigationId,
      durableWorkflow: true,
    });
    expect(started).not.toBeNull();
    if (started === null) throw new Error("Expected the investigation to start");
    await backend.mutation(internal.productsInvestigationActivities.start, {
      investigationId,
      investigationStartedAt: started.startedAt,
      key: "convex_agent_generate",
      sequence: 80,
      actor: "OpenAI through Convex Agent",
      operation: "generateText()",
      source: { kind: "local" },
    });

    await expect(
      backend.mutation(internal.products.failProductResearch, {
        investigationId,
        failure: "Product investigation workflow was canceled",
      }),
    ).resolves.toBe(true);

    const activities = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("productInvestigationActivities")
          .withIndex("by_investigation_id_and_sequence", (query) =>
            query.eq("investigationId", investigationId),
          )
          .collect(),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0]?.lifecycle).toMatchObject({
      status: "failed",
      attempt: 1,
      startedAt: NOW.getTime(),
      failedAt: NOW.getTime(),
      failure: "Product investigation workflow was canceled",
    });
  });

  it("tracks current running, completed, and failed attempts while preserving the prior result", async () => {
    const { backend, admin } = await authenticatedBackend();
    const { productId } = await admin.mutation(api.products.create, {
      url: "example.test",
      name: "Example",
    });
    const first = await admin.mutation(api.products.startInvestigation, { productId });

    const started = await backend.mutation(internal.products.markProductResearchRunning, {
      investigationId: first.investigationId,
    });
    expect(started).toMatchObject({
      productDomain: "example.test",
      productName: "Example",
      startedAt: NOW.getTime(),
    });
    await expect(
      backend.mutation(internal.products.markProductResearchRunning, {
        investigationId: first.investigationId,
      }),
    ).resolves.toBeNull();
    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: {
        _id: first.investigationId,
        status: "running",
        stage: "mapping",
        creditsUsed: null,
      },
    });
    await backend.mutation(internal.products.recordProductResearchRetrieval, {
      investigationId: first.investigationId,
      startedAt: NOW.getTime(),
      retrieval: createProductRetrievalMetadata({
        searchCredits: 0,
        mapCandidateCount: 5,
        selectedPageCount: 0,
        scrapedPageCount: 0,
        scrapeCredits: 0,
      }),
    });
    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: { status: "running", stage: "selecting", creditsUsed: 1 },
    });
    await backend.mutation(internal.products.recordProductResearchRetrieval, {
      investigationId: first.investigationId,
      startedAt: NOW.getTime(),
      retrieval: createProductRetrievalMetadata({
        searchCredits: 0,
        mapCandidateCount: 5,
        selectedPageCount: 2,
        scrapedPageCount: 0,
        scrapeCredits: 0,
      }),
    });
    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: { status: "running", stage: "scraping", creditsUsed: 1 },
    });
    await expect(
      backend.mutation(internal.products.recordProductResearchRetrieval, {
        investigationId: first.investigationId,
        startedAt: NOW.getTime(),
        retrieval: validRetrievalMetadata(),
      }),
    ).resolves.toBe(true);
    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: {
        _id: first.investigationId,
        provider: "firecrawl-convex",
        requestedModel: "openai/gpt-5.6-luna",
        status: "running",
        stage: "synthesizing",
        providerJobId: null,
        pollCount: 0,
        creditsUsed: 3,
      },
      latestCompletedInvestigation: null,
    });

    await expect(
      backend.mutation(internal.products.completeProductResearch, {
        investigationId: first.investigationId,
        startedAt: NOW.getTime(),
        retrieval: validRetrievalMetadata(),
        result: validInvestigationResult(),
      }),
    ).resolves.toBe(true);
    const completed = await onlyProduct(admin);
    expect(completed.latestInvestigation).toMatchObject({
      _id: first.investigationId,
      status: "completed",
      providerJobId: null,
      creditsUsed: 3,
      reportedModel: null,
      result: { summary: "Example presents a collaborative publishing product." },
    });
    expect(completed.latestCompletedInvestigation).toMatchObject({
      _id: first.investigationId,
      status: "completed",
      result: { summary: "Example presents a collaborative publishing product." },
    });

    const second = await admin.mutation(api.products.startInvestigation, { productId });
    expect(second.created).toBe(true);
    expect(second.investigationId).not.toBe(first.investigationId);
    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: { _id: second.investigationId, status: "queued" },
      latestCompletedInvestigation: {
        _id: first.investigationId,
        status: "completed",
      },
    });

    await backend.mutation(internal.products.markProductResearchRunning, {
      investigationId: second.investigationId,
    });
    await expect(
      backend.mutation(internal.products.failProductResearch, {
        investigationId: second.investigationId,
        failure: "Synthesis timed out",
        retrieval: validRetrievalMetadata(),
      }),
    ).resolves.toBe(true);
    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: {
        _id: second.investigationId,
        status: "failed",
        providerJobId: null,
        creditsUsed: 3,
        failure: "Synthesis timed out",
      },
      latestCompletedInvestigation: {
        _id: first.investigationId,
        status: "completed",
        result: { summary: "Example presents a collaborative publishing product." },
      },
    });
  });

  it("resets visible research without deleting history and blocks an active attempt", async () => {
    const { backend, admin } = await authenticatedBackend();
    const { productId } = await admin.mutation(api.products.create, {
      url: "example.test",
      name: "Example",
    });
    const first = await admin.mutation(api.products.startInvestigation, { productId });

    await expect(admin.mutation(api.products.resetResearch, { productId })).rejects.toThrow(
      "Wait for the active investigation to finish before resetting research",
    );
    await backend.mutation(internal.products.markProductResearchRunning, {
      investigationId: first.investigationId,
    });
    await expect(admin.mutation(api.products.resetResearch, { productId })).rejects.toThrow(
      "Wait for the active investigation to finish before resetting research",
    );
    await backend.mutation(internal.products.completeProductResearch, {
      investigationId: first.investigationId,
      startedAt: NOW.getTime(),
      retrieval: validRetrievalMetadata(),
      result: validInvestigationResult(),
    });

    await expect(admin.mutation(api.products.resetResearch, { productId })).resolves.toEqual({
      reset: true,
    });
    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: null,
      latestCompletedInvestigation: null,
    });
    await expect(admin.mutation(api.products.resetResearch, { productId })).resolves.toEqual({
      reset: false,
    });
    const preserved = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("productInvestigations")
          .withIndex("by_product_id", (q) => q.eq("productId", productId))
          .take(10),
    );
    expect(preserved).toHaveLength(1);
    expect(preserved[0]).toMatchObject({
      _id: first.investigationId,
      status: "completed",
    });

    const second = await admin.mutation(api.products.startInvestigation, { productId });
    expect(second.created).toBe(true);
    expect(second.investigationId).not.toBe(first.investigationId);
    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: { _id: second.investigationId, status: "queued" },
      latestCompletedInvestigation: null,
    });
  });

  it("lists a legacy failed row and creates the new family on retry", async () => {
    const { backend, userId, admin } = await authenticatedBackend();
    const { productId } = await admin.mutation(api.products.create, {
      url: "samebase.dev",
      name: "Samebase",
    });
    const legacyId = await backend.run(async (ctx) => {
      const investigationId = await ctx.db.insert("productInvestigations", {
        productId,
        requestedByUserId: userId,
        requestedAt: NOW.getTime() - 1_000,
        provider: "firecrawl-agent",
        requestedModel: "spark-2",
        effort: "medium",
        maxCredits: 150,
        status: "failed",
        failedAt: NOW.getTime() - 500,
        failure: "Legacy Firecrawl Agent request failed",
      });
      await ctx.db.patch("products", productId, {
        latestInvestigationId: investigationId,
      });
      return investigationId;
    });

    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: {
        _id: legacyId,
        provider: "firecrawl-agent",
        requestedModel: "spark-2",
        status: "failed",
        providerJobId: null,
        creditsUsed: null,
        failure: "Legacy Firecrawl Agent request failed",
      },
    });

    const retry = await admin.mutation(api.products.startInvestigation, { productId });
    const current = await backend.run(
      async (ctx) => await ctx.db.get("productInvestigations", retry.investigationId),
    );
    expect(retry.created).toBe(true);
    expect(current).toMatchObject({
      provider: "firecrawl-convex",
      requestedModel: "openai/gpt-5.6-luna",
      status: "queued",
      agentThreadId: expect.any(String),
    });
  });

  it("watchdog failure clears the active attempt and rejects late completion", async () => {
    const { backend, admin } = await authenticatedBackend();
    const { productId } = await admin.mutation(api.products.create, {
      url: "example.test",
      name: "Example",
    });
    const attempt = await admin.mutation(api.products.startInvestigation, { productId });
    await backend.mutation(internal.products.markProductResearchRunning, {
      investigationId: attempt.investigationId,
    });
    await backend.mutation(internal.products.recordProductResearchRetrieval, {
      investigationId: attempt.investigationId,
      startedAt: NOW.getTime(),
      retrieval: validRetrievalMetadata(),
    });

    vi.setSystemTime(new Date(NOW.getTime() + 4 * 60 * 1_000));
    await expect(
      backend.mutation(internal.products.watchdogProductResearch, {
        investigationId: attempt.investigationId,
        startedAt: NOW.getTime(),
      }),
    ).resolves.toBe(true);
    await expect(
      backend.mutation(internal.products.completeProductResearch, {
        investigationId: attempt.investigationId,
        startedAt: NOW.getTime(),
        retrieval: validRetrievalMetadata(),
        result: validInvestigationResult(),
      }),
    ).resolves.toBe(false);
    await expect(onlyProduct(admin)).resolves.toMatchObject({
      latestInvestigation: {
        _id: attempt.investigationId,
        status: "failed",
        creditsUsed: 3,
        failure: "Product investigation exceeded the four-minute limit",
      },
      latestCompletedInvestigation: null,
    });
    const product = await backend.run(async (ctx) => await ctx.db.get("products", productId));
    expect(product?.activeInvestigationId).toBeUndefined();
  });
});
describe("Product investigation parsing", () => {
  it("accepts first-party subdomains, normalizes fragments, and allows same-page tension evidence", () => {
    const result = parseProductInvestigationResult(validInvestigationResult(), "example.test");

    expect(result.sources.map((source) => source.url)).toEqual([
      "https://www.example.test/features",
      "https://docs.example.test/getting-started",
    ]);
    expect(result.claims[0]?.sourceUrl).toBe("https://www.example.test/features");
    expect(result.dependencies[0]?.sourceUrl).toBe("https://docs.example.test/getting-started");
    expect(result.tensions[0]?.evidence.map((evidence) => evidence.sourceUrl)).toEqual([
      "https://www.example.test/features",
      "https://www.example.test/features",
    ]);
  });

  it("rejects off-domain, non-HTTP, and uncited URLs", () => {
    const valid = validInvestigationResult();
    expect(() =>
      parseProductInvestigationResult(
        {
          ...valid,
          sources: [{ url: "https://other.test/features", title: "Other" }],
        },
        "example.test",
      ),
    ).toThrow("must belong to example.test");
    expect(() =>
      parseProductInvestigationResult(
        {
          ...valid,
          sources: [{ url: "ftp://example.test/features", title: "Features" }],
        },
        "example.test",
      ),
    ).toThrow("must be an HTTP or HTTPS URL without credentials");
    expect(() =>
      parseProductInvestigationResult(
        {
          ...valid,
          claims: [
            {
              ...validClaim(),
              sourceUrl: "https://example.test/claims/not-in-sources",
            },
          ],
        },
        "example.test",
      ),
    ).toThrow("must appear in Investigation sources");
  });

  it("rejects oversized values", () => {
    const valid = validInvestigationResult();
    expect(() =>
      parseProductInvestigationResult({ ...valid, summary: "x".repeat(4_001) }, "example.test"),
    ).toThrow("Investigation summary exceeds 4000 characters");
    expect(() =>
      parseProductInvestigationResult(
        {
          ...valid,
          claims: [{ ...validClaim(), support: "x".repeat(2_001) }],
        },
        "example.test",
      ),
    ).toThrow("Investigation claims[0].support exceeds 2000 characters");
    expect(() =>
      parseProductInvestigationResult(
        {
          ...valid,
          tensions: [
            {
              ...valid.tensions[0],
              evidence: [
                {
                  sourceUrl: "https://www.example.test/features",
                  evidenceExcerpt: "x".repeat(281),
                  pageTitle: "Features",
                },
                {
                  sourceUrl: "https://www.example.test/features",
                  evidenceExcerpt: "Qualifier",
                  pageTitle: "Features",
                },
              ],
            },
          ],
        },
        "example.test",
      ),
    ).toThrow("evidenceExcerpt exceeds 280 characters");
  });

  it("rejects invalid claim categories and access states", () => {
    const valid = validInvestigationResult();
    expect(() =>
      parseProductInvestigationResult(
        {
          ...valid,
          claims: [{ ...validClaim(), category: "marketing" }],
        },
        "example.test",
      ),
    ).toThrow("Investigation claims[0].category is invalid");
    expect(() =>
      parseProductInvestigationResult(
        {
          ...valid,
          access: { ...validAccess(), signupState: "public" },
        },
        "example.test",
      ),
    ).toThrow("Investigation access.signupState is invalid");
  });
});

describe("Product research retrieval", () => {
  it("accepts first-party subdomains and rejects URL attacks, assets, and lookalikes", () => {
    expect(
      normalizeFirstPartyResearchUrl(
        "https://docs.example.test/guides/start?campaign=1#step",
        "example.test",
      ),
    ).toBe("https://docs.example.test/guides/start");
    expect(
      normalizeFirstPartyResearchUrl("https://user:secret@example.test/pricing", "example.test"),
    ).toBeNull();
    expect(
      normalizeFirstPartyResearchUrl("https://example.test.evil.test/pricing", "example.test"),
    ).toBeNull();
    expect(
      normalizeFirstPartyResearchUrl("https://evil-example.test/pricing", "example.test"),
    ).toBeNull();
    expect(normalizeFirstPartyResearchUrl("ftp://example.test/pricing", "example.test")).toBeNull();
    expect(
      normalizeFirstPartyResearchUrl(
        "https://example.test/security/report.PDF?download=1",
        "example.test",
      ),
    ).toBeNull();
  });

  it("parses bounded Map, Search, and Scrape envelopes", () => {
    expect(
      parseFirecrawlMapResponse(
        {
          success: true,
          links: [
            {
              url: "https://example.test/pricing#plans",
              title: "Pricing",
              description: "Plans",
            },
            { url: "https://other.test/attack", title: "Other" },
            "https://docs.example.test/help?source=map",
          ],
        },
        "example.test",
      ),
    ).toEqual([
      {
        url: "https://example.test/pricing",
        title: "Pricing",
        description: "Plans",
      },
      {
        url: "https://docs.example.test/help",
        title: null,
        description: null,
      },
    ]);

    expect(
      parseFirecrawlSearchResponse(
        {
          success: true,
          creditsUsed: 1.2,
          data: {
            web: [
              {
                url: "https://example.test/security",
                title: "Security",
                description: "Trust center",
              },
            ],
          },
        },
        "example.test",
      ),
    ).toEqual({
      creditsUsed: 2,
      candidates: [
        {
          url: "https://example.test/security",
          title: "Security",
          description: "Trust center",
        },
      ],
    });

    const scraped = parseFirecrawlScrapeResponse(
      {
        success: true,
        data: {
          markdown: "x".repeat(MAX_RESEARCH_PAGE_CHARACTERS + 500),
          metadata: {
            sourceURL: "https://docs.example.test/features#hero",
            title: "Features",
          },
        },
      },
      {
        url: "https://example.test/features",
        title: "Requested features",
        description: null,
      },
      "example.test",
    );
    expect(scraped.url).toBe("https://docs.example.test/features");
    expect(scraped.title).toBe("Features");
    expect(scraped.markdown).toHaveLength(MAX_RESEARCH_PAGE_CHARACTERS);
  });

  it("rejects malformed or oversized provider envelopes", () => {
    expect(() => parseFirecrawlMapResponse(null, "example.test")).toThrow(
      "Firecrawl Map response must be an object",
    );
    expect(() =>
      parseFirecrawlMapResponse(
        {
          success: true,
          links: Array.from({ length: 101 }, (_, index) => `https://example.test/${index}`),
        },
        "example.test",
      ),
    ).toThrow("Firecrawl Map links exceeds 100 items");
    expect(() =>
      parseFirecrawlSearchResponse(
        {
          success: true,
          data: {
            web: Array.from({ length: 21 }, (_, index) => ({
              url: `https://example.test/${index}`,
            })),
          },
        },
        "example.test",
      ),
    ).toThrow("Firecrawl Search web results exceeds 20 items");
    expect(() =>
      parseFirecrawlScrapeResponse(
        {
          success: true,
          data: {
            markdown: "unsafe",
            metadata: { sourceURL: "https://example.test.evil.test/page" },
          },
        },
        { url: "https://example.test/page", title: null, description: null },
        "example.test",
      ),
    ).toThrow("unsafe source URL");
  });

  it("selects the homepage and at most five diverse pages deterministically", () => {
    const candidates = [
      { url: "https://example.test/signup", title: "Sign up", description: null },
      { url: "https://example.test/integrations", title: "Integrations", description: null },
      { url: "https://example.test/security", title: "Security", description: null },
      { url: "https://example.test/docs", title: "Documentation", description: null },
      { url: "https://example.test/features", title: "Features", description: null },
      { url: "https://example.test/pricing", title: "Pricing", description: null },
      { url: "https://example.test/about", title: "About", description: null },
    ];
    const selected = selectResearchCandidates(
      [...candidates].reverse(),
      "https://example.test",
      "example.test",
    );

    expect(selected).toHaveLength(MAX_RESEARCH_PAGES);
    expect(selected.map((candidate) => candidate.url)).toEqual([
      "https://example.test/",
      "https://example.test/pricing",
      "https://example.test/features",
      "https://example.test/docs",
      "https://example.test/security",
      "https://example.test/integrations",
    ]);
    expect(hasAdequateResearchCoverage(selected)).toBe(true);
  });

  it("keeps six pages and the prompt inside the 36k and nine-credit ceilings", () => {
    const pages = Array.from({ length: MAX_RESEARCH_PAGES }, (_, index) => ({
      url: `https://example.test/page-${index + 1}`,
      title: `Page ${index + 1}`,
      markdown: "evidence ".repeat(1_200),
    }));
    const prepared = buildProductResearchPrompt("Example", "example.test", pages);
    const retrieval = createProductRetrievalMetadata({
      searchCredits: 2,
      mapCandidateCount: 50,
      selectedPageCount: 6,
      scrapedPageCount: 5,
      scrapeCredits: 6,
    });

    expect(prepared.pages).toHaveLength(MAX_RESEARCH_PAGES);
    expect(
      prepared.pages.every((page) => page.markdown.length <= MAX_RESEARCH_PAGE_CHARACTERS),
    ).toBe(true);
    expect(prepared.prompt.length).toBeLessThanOrEqual(MAX_RESEARCH_PROMPT_CHARACTERS);
    expect(prepared.prompt).toContain("Return exactly one raw JSON object with this shape");
    expect(retrieval.totalCredits).toBe(MAX_RESEARCH_FIRECRAWL_CREDITS);
    expect(() =>
      createProductRetrievalMetadata({
        searchCredits: 3,
        mapCandidateCount: 50,
        selectedPageCount: 6,
        scrapedPageCount: 6,
        scrapeCredits: 6,
      }),
    ).toThrow("exceeds its bounds");
  });

  it("allows partial scrape success, rejects zero pages, and deduplicates redirects", () => {
    const page = {
      url: "https://example.test/",
      title: "Homepage",
      markdown: "Product evidence",
    };
    expect(
      requireUsableResearchPages([null, page, { ...page, title: "Redirected" }, null]),
    ).toEqual([page]);
    expect(() => requireUsableResearchPages([null, null])).toThrow("no usable first-party pages");
  });
});

describe("Product research synthesis", () => {
  it("parses one bounded raw JSON object with a strict fence fallback", () => {
    const json = JSON.stringify(validSynthesis());

    expect(parseProductResearchSynthesisText(json)).toEqual(validSynthesis());
    expect(parseProductResearchSynthesisText(`\n\`\`\`json\n${json}\n\`\`\`\n`)).toEqual(
      validSynthesis(),
    );
    expect(() => parseProductResearchSynthesisText(`Result:\n${json}`)).toThrow(
      "one valid JSON object",
    );
    expect(() => parseProductResearchSynthesisText(`${json}\n${json}`)).toThrow(
      "one valid JSON object",
    );
    expect(() => parseProductResearchSynthesisText(`\`\`\`JSON\n${json}\n\`\`\``)).toThrow(
      "invalid Markdown or prose",
    );
    expect(() =>
      parseProductResearchSynthesisText("x".repeat(MAX_RESEARCH_SYNTHESIS_TEXT_CHARACTERS + 1)),
    ).toThrow(`exceeds ${MAX_RESEARCH_SYNTHESIS_TEXT_CHARACTERS} characters`);
  });

  it("hydrates opaque source IDs and removes fabricated excerpts", () => {
    const literal = hydrateProductResearchResult(
      {
        ...validSynthesis(),
        claims: [
          {
            ...validSynthesis().claims[0],
            evidenceExcerpt: "publish your workspace in minutes.",
          },
        ],
      },
      [researchPage("S1")],
      "example.test",
    );
    const fabricated = hydrateProductResearchResult(
      {
        ...validSynthesis(),
        claims: [
          {
            ...validSynthesis().claims[0],
            evidenceExcerpt: "A fabricated guarantee not present on the page.",
          },
        ],
      },
      [researchPage("S1")],
      "example.test",
    );

    expect(literal.claims[0]).toMatchObject({
      sourceUrl: "https://example.test/features",
      pageTitle: "Example features",
      evidenceExcerpt: "publish your workspace in minutes.",
    });
    expect(literal.sources).toEqual([
      { url: "https://example.test/features", title: "Example features" },
    ]);
    expect(fabricated.claims[0]?.evidenceExcerpt).toBeNull();
  });

  it("validates then truncates harmless array overproduction", () => {
    const synthesis = validSynthesis();
    const claim = synthesis.claims[0];
    const parsed = parseProductResearchSynthesis({
      ...synthesis,
      audiences: Array.from({ length: 6 }, (_, index) => `Audience ${index + 1}`),
      claims: Array.from({ length: 13 }, (_, index) => ({
        ...claim,
        claim: `Claim ${index + 1}`,
        qualifiers: Array.from(
          { length: 5 },
          (_, qualifierIndex) => `Qualifier ${qualifierIndex + 1}`,
        ),
      })),
      dependencies: Array.from({ length: 9 }, (_, index) => ({
        name: `Dependency ${index + 1}`,
        relationship: "The product names this dependency.",
        sourceId: "S1",
      })),
      tensions: Array.from({ length: 6 }, (_, index) => ({
        summary: `Tension ${index + 1}`,
        evidence: Array.from({ length: 5 }, (_, evidenceIndex) => ({
          sourceId: "S1",
          evidenceExcerpt: `Evidence ${evidenceIndex + 1}`,
        })),
      })),
      access: {
        ...synthesis.access,
        requirements: Array.from({ length: 6 }, (_, index) => `Requirement ${index + 1}`),
      },
      unknowns: Array.from({ length: 9 }, (_, index) => `Unknown ${index + 1}`),
    });

    expect(parsed.audiences).toHaveLength(5);
    expect(parsed.claims).toHaveLength(12);
    expect(parsed.claims.every((item) => item.qualifiers.length === 4)).toBe(true);
    expect(parsed.dependencies).toHaveLength(8);
    expect(parsed.tensions).toHaveLength(5);
    expect(parsed.tensions.every((item) => item.evidence.length === 4)).toBe(true);
    expect(parsed.access.requirements).toHaveLength(5);
    expect(parsed.unknowns).toHaveLength(8);
    expect(() =>
      hydrateProductResearchResult(parsed, [researchPage("S1")], "example.test"),
    ).not.toThrow();
  });

  it("rejects unknown source IDs and malformed or oversized synthesis output", () => {
    expect(() =>
      hydrateProductResearchResult(validSynthesis("S6"), [researchPage("S1")], "example.test"),
    ).toThrow("unknown source ID S6");
    expect(() => parseProductResearchSynthesis(null)).toThrow();
    expect(() =>
      parseProductResearchSynthesis({
        ...validSynthesis(),
        summary: "x".repeat(4_001),
      }),
    ).toThrow();
    expect(() =>
      parseProductResearchSynthesis({
        ...validSynthesis(),
        claims: [],
      }),
    ).toThrow();
    expect(() =>
      parseProductResearchSynthesis({
        ...validSynthesis(),
        claims: [
          ...Array.from({ length: 12 }, () => validSynthesis().claims[0]),
          { ...validSynthesis().claims[0], category: "marketing" },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseProductResearchSynthesis({
        ...validSynthesis(),
        audiences: ["One", "Two", "Three", "Four", "Five", 6],
      }),
    ).toThrow();
  });
});
