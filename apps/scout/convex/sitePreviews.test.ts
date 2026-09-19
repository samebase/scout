/// <reference types="vite/client" />
import { R2 } from "@convex-dev/r2";
import { convexTest } from "convex-test";
import { Firecrawl, SdkError } from "firecrawl";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
import { publicPreviewKey } from "./scout/sitePreviewModel";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const providerImage = "https://storage.googleapis.com/firecrawl-media/screenshot-test.png";
const scrape = vi.fn<Firecrawl["scrape"]>();
const store = vi.fn<R2["store"]>();
const getUrl = vi.fn<R2["getUrl"]>();
const deleteObject = vi.fn<R2["deleteObject"]>();
const fetchImage = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_CLOUD_URL", "https://previews-test.convex.cloud");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  vi.stubEnv("R2_BUCKET", "test-bucket");
  vi.stubEnv("R2_ENDPOINT", "https://r2.example.test");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("PUBLIC_MEDIA_BUCKET", "public-previews");
  vi.stubEnv("PUBLIC_MEDIA_ORIGIN", "https://media.example.test");
  vi.stubEnv("PUBLIC_MEDIA_ACCESS_KEY_ID", "public-key");
  vi.stubEnv("PUBLIC_MEDIA_SECRET_ACCESS_KEY", "public-secret");
  vi.stubEnv("PUBLIC_MEDIA_ZONE_ID", "test-zone");
  vi.stubEnv("PUBLIC_MEDIA_CACHE_PURGE_TOKEN", "purge-token");
  scrape
    .mockReset()
    .mockResolvedValue({ screenshot: providerImage, metadata: { statusCode: 200 } });
  store.mockReset().mockResolvedValue("stored");
  getUrl.mockReset().mockResolvedValue("https://r2.example.test/signed");
  deleteObject.mockReset().mockResolvedValue(undefined);
  fetchImage
    .mockReset()
    .mockImplementation(async (input) =>
      (input instanceof Request ? input.url : input.toString()).includes("/purge_cache")
        ? Response.json({ success: true, errors: [] })
        : new Response(png, { headers: { "content-type": "image/png" } }),
    );
  vi.spyOn(Firecrawl.prototype, "scrape").mockImplementation(scrape);
  vi.spyOn(R2.prototype, "store").mockImplementation(store);
  vi.spyOn(R2.prototype, "getUrl").mockImplementation(getUrl);
  vi.spyOn(R2.prototype, "deleteObject").mockImplementation(deleteObject);
  vi.stubGlobal("fetch", fetchImage);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const backend = convexTest(schema, import.meta.glob("./**/*.ts"));
  const ids = await backend.run(async (ctx) => {
    const userId = await insertTestAccount(ctx, { email: "owner@example.test" });
    const otherId = await insertTestAccount(ctx, { email: "other@example.test" });
    const adminId = await insertTestAccount(ctx, { email: ADMIN_EMAIL });
    const scoutId = await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "inbox", address: "scout@example.test" },
      firecrawl: { profileName: "must-not-use-this-profile" },
    });
    const chatId = await ctx.db.insert("scoutChats", {
      userId,
      scoutId,
      threadId: "thread",
      createdAt: 1,
      purpose: { kind: "review" },
      visibility: "private",
      primarySite: "example.com",
      siteCounted: true,
    });
    const siteId = await ctx.db.insert("sites", {
      hostname: "example.com",
      latestPublicTask: null,
      taskCount: 1,
      publicTaskCount: 0,
    });
    await ctx.db.insert("siteUserListings", {
      userId,
      hostname: "example.com",
      latestTask: { chatId, createdAt: 1 },
      taskCount: 1,
    });
    return { userId, otherId, adminId, siteId, chatId };
  });
  return {
    ...ids,
    backend,
    owner: backend.withIdentity({ subject: ids.userId }),
    other: backend.withIdentity({ subject: ids.otherId }),
    admin: backend.withIdentity({ subject: ids.adminId }),
    inspect: () => backend.run((ctx) => ctx.db.get(ids.siteId)),
    ensure: () => backend.action(internal.scout.sitePreviews.ensure, { site: "example.com" }),
  };
}

test("captures the unauthenticated root once, including overlapping requests, into site-owned R2", async () => {
  const t = await setup();
  scrape.mockImplementationOnce(async () => {
    expect((await t.inspect())?.preview).toEqual({ kind: "capturing", startedAt: Date.now() });
    await t.ensure();
    return { screenshot: providerImage };
  });
  await t.ensure();
  await t.ensure();
  await t.admin.action(api.scout.sitePreviews.capture, { site: "example.com" });
  const preview = (await t.inspect())?.preview;
  if (preview?.kind !== "ready") throw new Error("Expected a ready preview");
  const key = preview.key;
  expect(key).toMatch(
    /^deployments\/previews-test\.convex\.cloud\/sites\/example\.com\/previews\/[\da-f-]{36}\.png$/,
  );
  expect(preview).toEqual({ kind: "ready", capturedAt: Date.now(), key });
  expect(scrape).toHaveBeenCalledExactlyOnceWith("https://example.com/", {
    formats: [{ type: "screenshot", fullPage: false, viewport: { width: 1440, height: 900 } }],
    maxAge: 0,
    timeout: 45_000,
    autoResume: false,
    proxy: "basic",
  });
  expect(store).toHaveBeenCalledExactlyOnceWith(expect.anything(), png, {
    key,
    type: "image/png",
    disposition: "inline",
  });
  expect(await t.backend.run((ctx) => ctx.db.query("agentsApiScreenshots").first())).toBeNull();
  expect(await t.backend.run((ctx) => ctx.db.query("agentsApiBrowserSessions").first())).toBeNull();
  const row = {
    hostname: "example.com",
    preview: { kind: "ready", capturedAt: Date.now() },
    profile: null,
    research: null,
  };
  expect(await t.owner.query(api.scout.sites.get, { site: "example.com" })).toEqual(row);
  expect(
    (
      await t.owner.query(api.scout.sites.list, {
        scope: "mine",
        site: null,
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page,
  ).toEqual([{ ...row, taskCount: 1 }]);
  expect(
    (
      await t.admin.query(api.scout.sites.list, {
        scope: "all",
        site: null,
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page,
  ).toEqual([{ ...row, taskCount: 1 }]);
  await t.backend.run((ctx) =>
    ctx.db.patch(t.siteId, {
      latestPublicTask: { chatId: t.chatId, createdAt: 1 },
      publicTaskCount: 1,
    }),
  );
  expect(
    (
      await t.backend.query(api.scout.sites.list, {
        scope: "public",
        site: null,
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page,
  ).toEqual([{ ...row, preview: { kind: "publishing", capturedAt: Date.now() }, taskCount: 1 }]);
});

test("publishes an unchanged PNG once and includes a stable URL in site queries without signing", async () => {
  const t = await setup();
  await t.owner.mutation(api.scout.chats.setVisibility, {
    threadId: "thread",
    visibility: "public",
  });
  await t.ensure();
  expect((await t.inspect())?.preview).toMatchObject({
    publication: { kind: "publishing", version: 1 },
  });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  const preview = (await t.inspect())?.preview;
  if (preview?.kind !== "ready") throw new Error("Missing capture");
  expect(preview.publication).toEqual({ kind: "public", version: 1 });
  const key = publicPreviewKey(preview.key, 1);
  expect(store).toHaveBeenCalledTimes(2);
  expect(store.mock.contexts[1]).toMatchObject({
    config: { bucket: "public-previews", accessKeyId: "public-key" },
  });
  expect(store).toHaveBeenLastCalledWith(expect.anything(), expect.any(Blob), {
    key,
    type: "image/png",
    disposition: "inline",
    cacheControl: "public, max-age=60, s-maxage=31536000, must-revalidate",
  });
  getUrl.mockClear();
  const site = await t.backend.query(api.scout.sites.get, { site: "example.com" });
  expect(site?.preview).toEqual({
    kind: "public",
    capturedAt: preview.capturedAt,
    url: `https://media.example.test/${key}`,
  });
  expect((await t.backend.query(api.scout.sites.get, { site: "example.com" }))?.preview).toEqual(
    site?.preview,
  );
  expect(getUrl).not.toHaveBeenCalled();
  await t.admin.action(api.scout.sitePreviews.capture, { site: "example.com" });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(store).toHaveBeenCalledTimes(2);
});

test("unpublishing removes only the public copy, purges its URL, and a later publication gets a new key", async () => {
  const t = await setup();
  await t.ensure();
  await t.owner.mutation(api.scout.chats.setVisibility, {
    threadId: "thread",
    visibility: "public",
  });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  const preview = (await t.inspect())?.preview;
  if (preview?.kind !== "ready") throw new Error("Missing capture");
  const key = publicPreviewKey(preview.key, 1);
  await t.owner.mutation(api.scout.chats.setVisibility, {
    threadId: "thread",
    visibility: "private",
  });
  expect(await t.backend.query(api.scout.sites.get, { site: "example.com" })).toBeNull();
  expect((await t.owner.query(api.scout.sites.get, { site: "example.com" }))?.preview?.kind).toBe(
    "ready",
  );
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(deleteObject).toHaveBeenCalledExactlyOnceWith(expect.anything(), key);
  expect(deleteObject.mock.contexts[0]).toMatchObject({ config: { bucket: "public-previews" } });
  expect(fetchImage).toHaveBeenCalledWith(
    "https://api.cloudflare.com/client/v4/zones/test-zone/purge_cache",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ files: [`https://media.example.test/${key}`] }),
    }),
  );
  await t.owner.mutation(api.scout.chats.setVisibility, {
    threadId: "thread",
    visibility: "public",
  });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    (await t.backend.query(api.scout.sites.get, { site: "example.com" }))?.preview,
  ).toMatchObject({
    kind: "public",
    url: `https://media.example.test/${publicPreviewKey(preview.key, 2)}`,
  });
  expect(scrape).toHaveBeenCalledTimes(1);
});

test("an upload finishing after unpublication cannot resurrect the public preview", async () => {
  const t = await setup();
  await t.ensure();
  await t.owner.mutation(api.scout.chats.setVisibility, {
    threadId: "thread",
    visibility: "public",
  });
  store.mockImplementationOnce(async () => {
    await t.owner.mutation(api.scout.chats.setVisibility, {
      threadId: "thread",
      visibility: "private",
    });
    return "uploaded";
  });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.inspect())?.preview).toMatchObject({
    publication: { kind: "private", version: 1 },
  });
  expect(await t.backend.query(api.scout.sites.get, { site: "example.com" })).toBeNull();
  expect(deleteObject).toHaveBeenCalled();
  expect(fetchImage).toHaveBeenCalledWith(
    "https://api.cloudflare.com/client/v4/zones/test-zone/purge_cache",
    expect.objectContaining({ method: "POST" }),
  );
});

test("existing public captures can be published in bounded batches without publishing private-only sites", async () => {
  const t = await setup();
  await t.ensure();
  const args = { paginationOpts: { cursor: null, numItems: 1 }, retryFailed: false };
  expect(
    await t.backend.mutation(internal.scout.sitePreviewRecords.publishExisting, args),
  ).toMatchObject({ processed: 1, isDone: true });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(store).toHaveBeenCalledTimes(1);
  await t.backend.run((ctx) =>
    ctx.db.patch(t.siteId, { latestPublicTask: { chatId: t.chatId, createdAt: 1 } }),
  );
  await t.backend.mutation(internal.scout.sitePreviewRecords.publishExisting, args);
  await t.backend.mutation(internal.scout.sitePreviewRecords.publishExisting, args);
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(store).toHaveBeenCalledTimes(2);
  expect((await t.inspect())?.preview).toMatchObject({
    publication: { kind: "public", version: 1 },
  });
});

test("cleanup from an older publication cannot delete a newer public copy", async () => {
  const t = await setup();
  await t.ensure();
  await t.owner.mutation(api.scout.chats.setVisibility, {
    threadId: "thread",
    visibility: "public",
  });
  store.mockImplementationOnce(async () => {
    await t.owner.mutation(api.scout.chats.setVisibility, {
      threadId: "thread",
      visibility: "private",
    });
    await t.owner.mutation(api.scout.chats.setVisibility, {
      threadId: "thread",
      visibility: "public",
    });
    return "older-upload-finished";
  });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  const preview = (await t.inspect())?.preview;
  if (preview?.kind !== "ready") throw new Error("Missing capture");
  expect(preview.publication).toEqual({ kind: "public", version: 2 });
  expect(deleteObject).toHaveBeenCalledWith(expect.anything(), publicPreviewKey(preview.key, 1));
  expect(deleteObject).not.toHaveBeenCalledWith(
    expect.anything(),
    publicPreviewKey(preview.key, 2),
  );
  expect(scrape).toHaveBeenCalledTimes(1);
});

test("a failed cache purge reports the Cloudflare status, code, and request ID for manual repair", async () => {
  const t = await setup();
  fetchImage.mockResolvedValueOnce(
    Response.json(
      { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
      { status: 403, headers: { "cf-ray": "purge-request-id" } },
    ),
  );
  await expect(
    t.backend.action(internal.scout.publicSitePreviews.remove, { key: "old-preview.png" }),
  ).rejects.toThrow(
    "Cloudflare POST /zones/test-zone/purge_cache failed (HTTP 403; 10000: Authentication error; request purge-request-id)",
  );
  expect(deleteObject).toHaveBeenCalledExactlyOnceWith(expect.anything(), "old-preview.png");
  expect(fetchImage).toHaveBeenCalledTimes(1);
});

test("publication fails visibly when removal credentials are missing and an admin can retry without recapturing", async () => {
  const t = await setup();
  await t.ensure();
  vi.stubEnv("PUBLIC_MEDIA_CACHE_PURGE_TOKEN", "");
  await t.owner.mutation(api.scout.chats.setVisibility, {
    threadId: "thread",
    visibility: "public",
  });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    (await t.backend.query(api.scout.sites.get, { site: "example.com" }))?.preview,
  ).toMatchObject({
    kind: "publication_failed",
    message: expect.stringContaining("PUBLIC_MEDIA_CACHE_PURGE_TOKEN"),
  });
  expect(store).toHaveBeenCalledTimes(1);
  vi.stubEnv("PUBLIC_MEDIA_CACHE_PURGE_TOKEN", "purge-token");
  await t.backend.mutation(internal.scout.sitePreviewRecords.publishExisting, {
    paginationOpts: { cursor: null, numItems: 1 },
    retryFailed: false,
  });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect(store).toHaveBeenCalledTimes(1);
  await expect(
    t.other.action(api.scout.sitePreviews.capture, { site: "example.com" }),
  ).rejects.toThrow("Not authorized");
  await t.admin.action(api.scout.sitePreviews.capture, { site: "example.com" });
  await t.backend.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.inspect())?.preview).toMatchObject({
    publication: { kind: "public", version: 2 },
  });
  expect(scrape).toHaveBeenCalledTimes(1);
});

test("records failures, never automatically retries, and allows only an admin to retry", async () => {
  const t = await setup();
  scrape.mockRejectedValueOnce(new Error("Provider refused https://secret.test/?token=secret"));
  await expect(t.ensure()).resolves.toBeNull();
  expect((await t.inspect())?.preview).toEqual({
    kind: "failed",
    failedAt: Date.now(),
    message: "Provider refused [url redacted]",
  });
  await t.ensure();
  expect(scrape).toHaveBeenCalledTimes(1);
  for (const client of [t.backend, t.owner, t.other]) {
    await expect(
      client.action(api.scout.sitePreviews.capture, { site: "example.com" }),
    ).rejects.toThrow("Not authorized");
  }
  expect(store).not.toHaveBeenCalled();
  await t.admin.action(api.scout.sitePreviews.capture, { site: "example.com" });
  expect((await t.inspect())?.preview?.kind).toBe("ready");
  expect(scrape).toHaveBeenCalledTimes(2);
});

test("checks current private-site access before signing, including after public visibility is removed", async () => {
  const t = await setup();
  const args = { site: "example.com" };
  expect(await t.owner.action(api.scout.sitePreviews.imageUrl, args)).toBeNull();
  await t.ensure();
  for (const client of [t.backend, t.other]) {
    expect(await client.action(api.scout.sitePreviews.imageUrl, args)).toBeNull();
  }
  expect(getUrl).not.toHaveBeenCalled();
  for (const client of [t.owner, t.admin]) {
    expect(await client.action(api.scout.sitePreviews.imageUrl, args)).toEqual({
      url: "https://r2.example.test/signed",
      expiresAtMs: Date.now() + 900_000,
    });
  }
  await t.backend.run((ctx) =>
    ctx.db.patch(t.siteId, {
      latestPublicTask: { chatId: t.chatId, createdAt: 1 },
    }),
  );
  expect(await t.backend.action(api.scout.sitePreviews.imageUrl, args)).not.toBeNull();
  await t.backend.run((ctx) => ctx.db.patch(t.siteId, { latestPublicTask: null }));
  getUrl.mockClear();
  expect(await t.backend.action(api.scout.sitePreviews.imageUrl, args)).toBeNull();
  expect(
    await t.backend.action(api.scout.sitePreviews.imageUrl, { site: "absent.test" }),
  ).toBeNull();
  expect(getUrl).not.toHaveBeenCalled();
});

test("an upload failure is inspectable and cleans the site object without retrying", async () => {
  const t = await setup();
  store.mockRejectedValueOnce(new Error("R2 upload failed"));
  deleteObject.mockRejectedValueOnce(new Error("R2 cleanup failed"));
  await t.ensure();
  expect((await t.inspect())?.preview).toMatchObject({
    kind: "failed",
    message: "R2 upload failed Image cleanup also failed: R2 cleanup failed",
  });
  expect(deleteObject).toHaveBeenCalledOnce();
  expect(store).toHaveBeenCalledWith(expect.anything(), png, {
    key: deleteObject.mock.calls[0][1],
    type: "image/png",
    disposition: "inline",
  });
  await t.ensure();
  expect(store).toHaveBeenCalledTimes(1);
});

test("delayed cleanup of a failed upload cannot delete a successful retry at the same timestamp", async () => {
  const t = await setup();
  const objects = new Set<string>();
  const deletions: string[] = [];
  store.mockImplementation(async (_ctx, _bytes, options) => {
    const key = typeof options === "string" ? options : options?.key;
    if (!key) throw new Error("Expected a site preview key");
    objects.add(key);
    if (objects.size === 1) throw new Error("Upload failed after storing the object");
    return key;
  });
  deleteObject.mockImplementation(async (_ctx, key) => {
    deletions.push(key);
  });
  const timestamp = Date.now();
  await t.ensure();
  expect((await t.inspect())?.preview?.kind).toBe("failed");
  expect(deletions).toHaveLength(1);
  await t.admin.action(api.scout.sitePreviews.capture, { site: "example.com" });
  const preview = (await t.inspect())?.preview;
  if (preview?.kind !== "ready") throw new Error("Expected the retry to be ready");
  expect(Date.now()).toBe(timestamp);
  expect(preview.key).not.toBe(deletions[0]);
  for (const key of deletions) objects.delete(key);
  expect([...objects]).toEqual([preview.key]);
  expect(store).toHaveBeenCalledTimes(2);
  expect(scrape).toHaveBeenCalledTimes(2);
});

test("records a continuing provider job timeout as a failure without another capture attempt", async () => {
  const t = await setup();
  scrape.mockRejectedValueOnce(
    new SdkError(
      "Scrape timed out",
      408,
      "SCRAPE_TIMEOUT",
      { state: "processing_continues" },
      "job-1",
    ),
  );
  await expect(t.ensure()).resolves.toBeNull();
  expect((await t.inspect())?.preview).toEqual({
    kind: "failed",
    failedAt: Date.now(),
    message: "Scrape timed out",
  });
  expect(scrape).toHaveBeenCalledWith(
    "https://example.com/",
    expect.objectContaining({
      timeout: 45_000,
      autoResume: false,
    }),
  );
  await t.ensure();
  expect(scrape).toHaveBeenCalledTimes(1);
  expect(store).not.toHaveBeenCalled();
});

test("fails closed on untrusted provider images before download or upload", async () => {
  const t = await setup();
  scrape.mockResolvedValueOnce({ screenshot: "http://169.254.169.254/latest/meta-data" });
  await t.ensure();
  expect((await t.inspect())?.preview?.kind).toBe("failed");
  expect(fetchImage).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
});
