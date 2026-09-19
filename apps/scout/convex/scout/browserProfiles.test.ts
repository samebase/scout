import { convexTest } from "convex-test";
import { Firecrawl, SdkError } from "firecrawl";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../scout/${path.slice(2)}`,
      module,
    ]),
  ),
};
const previousSummary = { cookieCount: 10, cookieDomainCount: 3, checkedAt: 1 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function setup() {
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl-key");
  const backend = convexTest(schema, modules);
  const { adminId, memberId, scoutId } = await backend.run(async (ctx) => ({
    adminId: await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
    memberId: await insertTestAccount(ctx, { email: "member@example.test" }),
    scoutId: await ctx.db.insert("scouts", {
      displayName: "Conrad",
      slug: "conrad",
      status: "active",
      websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
      agentMail: { inboxId: "conrad", address: "conrad@example.test" },
      firecrawl: { profileName: "scout-conrad" },
      browserProfileSummary: previousSummary,
    }),
  }));
  const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
  const member = backend.withIdentity({ subject: `${memberId}|test-session` });
  const create = vi.spyOn(Firecrawl.prototype, "browser").mockResolvedValue({
    success: true,
    id: "profile-check",
  });
  const execute = vi.spyOn(Firecrawl.prototype, "browserExecute").mockResolvedValue({
    success: true,
    result: JSON.stringify({ cookieCount: 427, cookieDomainCount: 40 }),
  });
  const close = vi.spyOn(Firecrawl.prototype, "deleteBrowser").mockResolvedValue({ success: true });
  const readSummary = async () =>
    (await admin.query(api.scout.scouts.resources, { scoutId }))?.browserProfileSummary;
  return { backend, admin, member, scoutId, create, execute, close, readSummary };
}

it("opens the scout's saved profile without writing it and caches only counts after closing", async () => {
  const { admin, scoutId, create, execute, close, readSummary } = await setup();
  close.mockImplementation(async () => {
    expect(await readSummary()).toEqual(previousSummary);
    return { success: true };
  });
  await admin.action(api.scout.browserProfiles.refresh, { scoutId });
  expect(create).toHaveBeenCalledExactlyOnceWith({
    profile: { name: "scout-conrad", saveChanges: false },
    ttl: 120,
    activityTtl: 120,
    streamWebView: false,
  });
  expect(execute).toHaveBeenCalledWith("profile-check", {
    language: "node",
    code: expect.stringContaining("page.context().cookies()"),
  });
  expect(close).toHaveBeenCalledExactlyOnceWith("profile-check");
  expect(await readSummary()).toEqual({
    cookieCount: 427,
    cookieDomainCount: 40,
    checkedAt: expect.any(Number),
  });
});

it("rejects anonymous and non-admin refreshes before opening a browser", async () => {
  const { backend, member, scoutId, create } = await setup();
  await expect(backend.action(api.scout.browserProfiles.refresh, { scoutId })).rejects.toThrow(
    "Not authorized",
  );
  await expect(member.action(api.scout.browserProfiles.refresh, { scoutId })).rejects.toThrow(
    "Not authorized",
  );
  expect(create).not.toHaveBeenCalled();
  const publicScout = await backend.query(api.scout.scouts.get, { slug: "conrad" });
  expect(publicScout).not.toHaveProperty("browserProfileSummary");
});

it("stores an observed empty profile as zero", async () => {
  const { admin, scoutId, execute, readSummary } = await setup();
  execute.mockResolvedValue({ success: true, result: '{"cookieCount":0,"cookieDomainCount":0}' });
  await admin.action(api.scout.browserProfiles.refresh, { scoutId });
  expect(await readSummary()).toMatchObject({ cookieCount: 0, cookieDomainCount: 0 });
});

it.each([
  { success: false, error: "Execution failed" },
  { success: true, exitCode: 1, stderr: "Script failed" },
  { success: true, killed: true },
  { success: true, result: "not JSON" },
  { success: true, result: '{"cookieCount":-1,"cookieDomainCount":0}' },
  { success: true },
])("closes failed inspections and keeps the last saved summary: %j", async (response) => {
  const { admin, scoutId, execute, close, readSummary } = await setup();
  execute.mockResolvedValue(response);
  await expect(admin.action(api.scout.browserProfiles.refresh, { scoutId })).rejects.toThrow();
  expect(close).toHaveBeenCalledExactlyOnceWith("profile-check");
  expect(await readSummary()).toEqual(previousSummary);
});

it("surfaces provider status and code without replacing the cached count", async () => {
  const { admin, scoutId, create, close, readSummary } = await setup();
  create.mockRejectedValue(new SdkError("Rate limit reached", 429, "RATE_LIMIT_EXCEEDED"));
  await expect(admin.action(api.scout.browserProfiles.refresh, { scoutId })).rejects.toThrow(
    "Firecrawl POST /v2/browser: Rate limit reached (HTTP 429, code RATE_LIMIT_EXCEEDED)",
  );
  expect(close).not.toHaveBeenCalled();
  expect(await readSummary()).toEqual(previousSummary);
});

it("reports failed cleanup and does not save a new summary", async () => {
  const { admin, scoutId, close, readSummary } = await setup();
  close.mockResolvedValue({ success: false, error: "Session is still active" });
  await expect(admin.action(api.scout.browserProfiles.refresh, { scoutId })).rejects.toThrow(
    "Firecrawl DELETE /v2/browser/profile-check: Session is still active",
  );
  expect(await readSummary()).toEqual(previousSummary);
});

it("does not attach a result to a changed profile or overwrite a newer observation", async () => {
  const { backend, scoutId, readSummary } = await setup();
  await backend.mutation(internal.scout.scouts.saveBrowserProfileSummary, {
    scoutId,
    profileName: "scout-conrad",
    summary: { cookieCount: 0, cookieDomainCount: 0, checkedAt: 0 },
  });
  expect(await readSummary()).toEqual(previousSummary);
  await expect(
    backend.mutation(internal.scout.scouts.saveBrowserProfileSummary, {
      scoutId,
      profileName: "another-profile",
      summary: { cookieCount: 0, cookieDomainCount: 0, checkedAt: 2 },
    }),
  ).rejects.toThrow("Scout browser profile changed");
});
