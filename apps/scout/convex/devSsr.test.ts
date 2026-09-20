/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertTestAccount } from "./testing/accounts";

beforeEach(() => {
  vi.stubEnv("CONVEX_DEPLOYMENT", "preview:ssr-test");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://ssr-test.convex.cloud");
  vi.stubEnv("SSR_FIXTURE_DEPLOYMENT_URL", "https://ssr-test.convex.cloud");
  vi.stubEnv("DEV_SEED_AUTH_ENABLED", "true");
  vi.stubEnv("DEV_SEED_AUTH_EMAIL", "ssr@example.test");
  vi.stubEnv("DEV_SEED_AUTH_PASSWORD", "fixture-password");
});
afterEach(() => vi.unstubAllEnvs());

test("seeds paginated public reviews once and keeps private reviews out of the public feed", async () => {
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  await backend.run((ctx) => insertTestAccount(ctx, { email: "ssr@example.test" }));
  await backend.mutation(internal.devSsr.seed, {});
  await backend.mutation(internal.devSsr.seed, {});
  expect(await backend.query(api.scout.sites.count, { scope: "public" })).toEqual({
    count: 8,
    hasMore: false,
  });
  const sites = await backend.query(api.scout.sites.list, {
    site: null,
    scope: "public",
    paginationOpts: { numItems: 6, cursor: null },
  });
  expect(sites.page).toHaveLength(6);
  expect(sites.isDone).toBe(false);
  for (const site of sites.page) {
    const tasks = await backend.query(api.scout.activity.list, {
      site: site.hostname,
      scope: "public",
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(tasks.page).toHaveLength(1);
    expect(tasks.page[0].title).toContain("public review");
  }
  expect(await backend.run((ctx) => ctx.db.query("scoutChats").collect())).toHaveLength(16);
});

test.each(["https://different.convex.cloud", ""])("refuses to seed %s", async (deployment) => {
  vi.stubEnv("SSR_FIXTURE_DEPLOYMENT_URL", deployment);
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  await expect(backend.mutation(internal.devSsr.seed, {})).rejects.toThrow(
    "Explicitly enable SSR fixtures for this deployment URL",
  );
});
