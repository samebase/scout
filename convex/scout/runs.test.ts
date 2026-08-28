import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { ADMIN_EMAIL } from "../authConfig";
import schema from "../schema";

const modules = {
  ...import.meta.glob("../**/*.*s"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./runs.ts")).map(([path, module]) => [
      `../scout/${path.slice(2)}`,
      module,
    ]),
  ),
};
const runsApi = anyApi["scout"]["runs"];

function testBackend() {
  return convexTest(schema, modules);
}

async function insertUser(backend: ReturnType<typeof testBackend>) {
  return await backend.run(async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }));
}

const scoutFields = {
  displayName: "Test Scout",
  slug: "conrad",
  status: "active" as const,
  agentMail: {
    inboxId: "test-inbox-scout",
    address: "test-scout@example.test",
  },
  firecrawl: {
    profileName: "test-scout-profile",
  },
};

function runFields(overrides: Record<string, unknown> = {}) {
  return {
    scoutName: "Test Scout",
    scoutEmail: "test-scout@example.test",
    targetUrl: "https://example.com/target",
    mission: "Inspect the target",
    status: { kind: "pending" as const },
    browser: { kind: "none" as const },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("Scout runs", () => {
  it("rejects unauthenticated list reads", async () => {
    const backend = testBackend();

    await expect(backend.query(runsApi["list"], {})).rejects.toThrow("Not authorized");
  });

  it("lists newest runs first and projects only safe browse fields", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const runIds = await backend.run(async (ctx) => {
      const oldRunId = await ctx.db.insert("scoutRuns", runFields());
      const newRunId = await ctx.db.insert(
        "scoutRuns",
        runFields({
          createdAt: 2,
          updatedAt: 3,
          browser: {
            kind: "active",
            sessionId: "secret-session",
            liveViewUrl: "https://live.example.com/view",
            interactiveLiveViewUrl: "https://live.example.com/interactive",
            expiresAt: "secret-expiry",
          },
          status: {
            kind: "completed",
            resultUrl: "https://private.example.com/result",
            summary: "A completed summary",
            completedAt: 3,
          },
        }),
      );
      return { oldRunId, newRunId };
    });

    const listed = await admin.query(runsApi["list"], {});

    expect(listed.map((run: { runId: string }) => run.runId)).toEqual([
      runIds.newRunId,
      runIds.oldRunId,
    ]);
    expect(listed[0]).toEqual({
      runId: runIds.newRunId,
      scoutName: "Test Scout",
      targetUrl: "https://example.com/target",
      mission: "Inspect the target",
      status: "completed",
      createdAt: 2,
      updatedAt: 3,
      summary: "A completed summary",
    });
    expect(listed[0]).not.toHaveProperty("scoutEmail");
    expect(listed[0]).not.toHaveProperty("browser");
    expect(listed[0]).not.toHaveProperty("resultUrl");
    expect(listed[0]).not.toHaveProperty("error");
    expect(listed[1]).not.toHaveProperty("summary");
  });

  it("filters newest runs by scout id", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const ids = await backend.run(async (ctx) => {
      const firstScoutId = await ctx.db.insert("scouts", scoutFields);
      const secondScoutId = await ctx.db.insert("scouts", { ...scoutFields, slug: "other" });
      const matchingOldRunId = await ctx.db.insert(
        "scoutRuns",
        runFields({ scoutId: firstScoutId, createdAt: 1 }),
      );
      const matchingNewRunId = await ctx.db.insert(
        "scoutRuns",
        runFields({ scoutId: firstScoutId, createdAt: 3 }),
      );
      await ctx.db.insert("scoutRuns", runFields({ scoutId: secondScoutId, createdAt: 2 }));
      return { firstScoutId, matchingOldRunId, matchingNewRunId };
    });

    await expect(
      admin.query(runsApi["list"], { scoutId: ids.firstScoutId }),
    ).resolves.toMatchObject([{ runId: ids.matchingNewRunId }, { runId: ids.matchingOldRunId }]);
  });

  it("attaches an initial run to a registered Scout by canonical email", async () => {
    const backend = testBackend();
    const scoutId = await backend.run(async (ctx) => await ctx.db.insert("scouts", scoutFields));

    const runId = await backend.mutation(runsApi["create"], {
      scoutName: "Test Scout",
      scoutEmail: "  TEST-SCOUT@EXAMPLE.TEST  ",
      targetUrl: "https://example.com/initial",
      mission: "Inspect the initial target",
    });

    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutRuns", runId)),
    ).resolves.toMatchObject({
      scoutId,
      scoutEmail: scoutFields.agentMail.address,
    });
  });

  it("links a future run to the registered scout by the latest identity email", async () => {
    const backend = testBackend();
    const { scoutId, latestRunId } = await backend.run(async (ctx) => {
      const scoutId = await ctx.db.insert("scouts", scoutFields);
      const latestRunId = await ctx.db.insert(
        "scoutRuns",
        runFields({ createdAt: 10, scoutEmail: scoutFields.agentMail.address }),
      );
      return { scoutId, latestRunId };
    });

    const futureRunId = await backend.mutation(runsApi["createWithLatestIdentity"], {
      targetUrl: "https://example.com/future",
      mission: "Check the future target",
    });

    const linkedRuns = await backend.run(async (ctx) => {
      const latestRun = await ctx.db.get("scoutRuns", latestRunId);
      const futureRun = await ctx.db.get("scoutRuns", futureRunId);
      return { latestRun, futureRun };
    });
    expect(linkedRuns.latestRun).not.toHaveProperty("scoutId");
    expect(linkedRuns.futureRun).toMatchObject({
      scoutId,
      scoutEmail: scoutFields.agentMail.address,
    });
  });

  it("keeps a valid latest scoutId authoritative over the latest email", async () => {
    const backend = testBackend();
    const ids = await backend.run(async (ctx) => {
      const authoritativeScoutId = await ctx.db.insert("scouts", scoutFields);
      const emailMatchScoutId = await ctx.db.insert("scouts", {
        ...scoutFields,
        slug: "email-match",
        agentMail: { ...scoutFields.agentMail, address: "email-match@example.test" },
      });
      await ctx.db.insert(
        "scoutRuns",
        runFields({
          createdAt: 10,
          scoutEmail: "email-match@example.test",
          scoutId: authoritativeScoutId,
        }),
      );
      return { authoritativeScoutId, emailMatchScoutId };
    });

    const futureRunId = await backend.mutation(runsApi["createWithLatestIdentity"], {
      targetUrl: "https://example.com/future-authoritative",
      mission: "Keep the existing owner",
    });

    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutRuns", futureRunId)),
    ).resolves.toMatchObject({
      scoutId: ids.authoritativeScoutId,
      scoutEmail: "email-match@example.test",
    });
    expect(ids.emailMatchScoutId).not.toBe(ids.authoritativeScoutId);
  });

  it("keeps creating a future run working when the registry has no match", async () => {
    const backend = testBackend();
    await backend.run(async (ctx) => {
      await ctx.db.insert("scoutRuns", runFields({ scoutEmail: "legacy@example.com" }));
    });

    const futureRunId = await backend.mutation(runsApi["createWithLatestIdentity"], {
      targetUrl: "https://example.com/future",
      mission: "Check the future target",
    });

    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutRuns", futureRunId)),
    ).resolves.toMatchObject({
      scoutEmail: "legacy@example.com",
    });
    await expect(
      backend.run(async (ctx) => await ctx.db.get("scoutRuns", futureRunId)),
    ).resolves.not.toHaveProperty("scoutId");
  });
});
