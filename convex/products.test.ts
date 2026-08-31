/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function testBackend() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  workflowTest.register(backend);
  return backend;
}

async function adminBackend() {
  const backend = testBackend();
  const userId = await backend.run(
    async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
  );
  return {
    backend,
    admin: backend.withIdentity({ subject: `${userId}|test-session` }),
  };
}

describe("Products", () => {
  it("requires the app operator and canonicalizes product domains", async () => {
    const backend = testBackend();
    await expect(backend.query(api.products.list, {})).rejects.toThrow("Not authorized");

    const { admin } = await adminBackend();
    const first = await admin.mutation(api.products.create, {
      url: "https://www.Example.test/pricing?from=test",
      name: "Example",
    });
    const duplicate = await admin.mutation(api.products.create, {
      url: "example.test",
    });
    expect(duplicate).toEqual({ productId: first.productId, created: false });
    await expect(admin.query(api.products.list, {})).resolves.toEqual([
      expect.objectContaining({
        _id: first.productId,
        name: "Example",
        domain: "example.test",
        primaryUrl: "https://example.test",
      }),
    ]);
  });

  it("keeps one current research request active after a double click", async () => {
    const { admin } = await adminBackend();
    const product = await admin.mutation(api.products.create, {
      url: "cloudflare.com",
      name: "Cloudflare",
    });
    const first = await admin.mutation(api.products.startInvestigation, {
      productId: product.productId,
    });
    const second = await admin.mutation(api.products.startInvestigation, {
      productId: product.productId,
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ investigationId: first.investigationId, created: false });
    const listed = await admin.query(api.products.getByDomain, { domain: "cloudflare.com" });
    expect(listed?.latestInvestigation).toEqual(
      expect.objectContaining({
        _id: first.investigationId,
        provider: "firecrawl-convex",
        requestedModel: "qwen/qwen3.7-flash",
        status: "queued",
      }),
    );
  });
});
