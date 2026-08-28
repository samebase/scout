import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { ADMIN_EMAIL } from "../authConfig";
import schema from "../schema";

const modules = {
  ...import.meta.glob("../**/*.*s"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./scouts.ts")).map(([path, module]) => [
      `../scout/${path.slice(2)}`,
      module,
    ]),
  ),
};
const scoutsApi = anyApi["scout"]["scouts"];

function testBackend() {
  return convexTest(schema, modules);
}

async function insertUser(backend: ReturnType<typeof testBackend>, email: string) {
  return await backend.run(async (ctx) => await ctx.db.insert("users", { email }));
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

const scoutRegistrationFields = {
  displayName: scoutFields.displayName,
  websiteIdentity: {
    firstName: "Conrad",
    lastName: "Scout",
  },
  slug: scoutFields.slug,
  agentMail: scoutFields.agentMail,
  firecrawl: scoutFields.firecrawl,
};

describe("Scout registry", () => {
  it("rejects unauthenticated list and get reads", async () => {
    const backend = testBackend();
    await backend.run(async (ctx) => await ctx.db.insert("scouts", scoutFields));

    await expect(backend.query(scoutsApi["list"], {})).rejects.toThrow("Not authorized");
    await expect(backend.query(scoutsApi["get"], { slug: "conrad" })).rejects.toThrow(
      "Not authorized",
    );
  });

  it("lets the admin register a Scout without exposing update semantics", async () => {
    const backend = testBackend();

    await expect(backend.mutation(scoutsApi["register"], scoutRegistrationFields)).rejects.toThrow(
      "Not authorized",
    );
    const nonAdminId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(nonAdmin.mutation(scoutsApi["register"], scoutRegistrationFields)).rejects.toThrow(
      "Not authorized",
    );

    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    await expect(
      admin.mutation(scoutsApi["register"], {
        ...scoutRegistrationFields,
        displayName: "  Test Scout  ",
        websiteIdentity: {
          firstName: "  Conrad  ",
          lastName: "  Scout  ",
        },
        slug: "  CONRAD  ",
        agentMail: {
          inboxId: "  test-inbox-scout  ",
          address: "  TEST-SCOUT@EXAMPLE.TEST  ",
        },
      }),
    ).resolves.toMatchObject({ created: true, linkedRunCount: 0, linkLimitReached: false });
    await expect(admin.query(scoutsApi["list"], {})).resolves.toMatchObject([
      {
        displayName: "Test Scout",
        websiteIdentity: {
          firstName: "Conrad",
          lastName: "Scout",
        },
        slug: "conrad",
        agentMail: {
          inboxId: "test-inbox-scout",
          address: "test-scout@example.test",
        },
      },
    ]);

    await expect(admin.mutation(scoutsApi["register"], scoutRegistrationFields)).rejects.toThrow(
      "slug is already registered",
    );
  });

  it("requires a complete website identity for public registration", async () => {
    const backend = testBackend();
    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    const { websiteIdentity: _websiteIdentity, ...legacyRegistrationFields } =
      scoutRegistrationFields;

    await expect(admin.mutation(scoutsApi["register"], legacyRegistrationFields)).rejects.toThrow(
      "websiteIdentity",
    );
    await expect(
      admin.mutation(scoutsApi["register"], {
        ...legacyRegistrationFields,
        websiteIdentity: { firstName: "Conrad" },
      }),
    ).rejects.toThrow("lastName");
  });

  it("canonicalizes scout input and returns an exact safe public projection", async () => {
    const backend = testBackend();
    const first = await backend.mutation(scoutsApi["upsert"], {
      ...scoutFields,
      displayName: "  Test Scout Updated  ",
      websiteIdentity: {
        firstName: "  Conrad  ",
        lastName: "  Scout  ",
      },
      slug: "  ConRad ",
      agentMail: {
        inboxId: "  test-inbox-scout  ",
        address: "  TEST-SCOUT@EXAMPLE.TEST  ",
      },
      firecrawl: { profileName: "  test-scout-profile  " },
    });

    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    const listed = await admin.query(scoutsApi["list"], {});
    const expectedScout = {
      _id: first.scoutId,
      displayName: "Test Scout Updated",
      websiteIdentity: {
        firstName: "Conrad",
        lastName: "Scout",
      },
      slug: "conrad",
      status: "active" as const,
      agentMail: {
        inboxId: "test-inbox-scout",
        address: "test-scout@example.test",
      },
      firecrawl: { profileName: "test-scout-profile" },
    };
    expect(listed).toEqual([expectedScout]);
    await expect(
      backend.run(async (ctx) => await ctx.db.get("scouts", first.scoutId)),
    ).resolves.toMatchObject(expectedScout);

    await expect(admin.query(scoutsApi["get"], { slug: "  CONRAD  " })).resolves.toEqual(
      expectedScout,
    );
    await expect(
      backend.query(scoutsApi["getRuntimeIdentity"], { scoutId: first.scoutId }),
    ).resolves.toMatchObject({
      displayName: "Test Scout Updated",
      websiteIdentity: {
        firstName: "Conrad",
        lastName: "Scout",
      },
      agentMail: {
        address: "test-scout@example.test",
      },
    });
    await expect(admin.query(scoutsApi["get"], { slug: "missing" })).resolves.toBeNull();
    await expect(admin.query(scoutsApi["get"], { slug: "not a slug" })).rejects.toThrow(
      "Scout slug",
    );
  });

  it("keeps website identity optional for legacy storage and internal upserts", async () => {
    const backend = testBackend();
    const { scoutId } = await backend.mutation(scoutsApi["upsert"], scoutFields);
    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });

    await expect(admin.query(scoutsApi["get"], { slug: scoutFields.slug })).resolves.toEqual({
      _id: scoutId,
      ...scoutFields,
    });
    await expect(backend.query(scoutsApi["getRuntimeIdentity"], { scoutId })).resolves.toEqual({
      displayName: scoutFields.displayName,
      status: scoutFields.status,
      agentMail: scoutFields.agentMail,
      firecrawl: scoutFields.firecrawl,
    });
  });

  it("preserves website identity when an upsert omits it", async () => {
    const backend = testBackend();
    const created = await backend.mutation(scoutsApi["upsert"], {
      ...scoutFields,
      websiteIdentity: {
        firstName: "Conrad",
        lastName: "Scout",
      },
    });

    await backend.mutation(scoutsApi["upsert"], {
      ...scoutFields,
      displayName: "Updated display name",
    });

    await expect(
      backend.run(async (ctx) => await ctx.db.get("scouts", created.scoutId)),
    ).resolves.toMatchObject({
      displayName: "Updated display name",
      websiteIdentity: {
        firstName: "Conrad",
        lastName: "Scout",
      },
    });
  });

  it("projects only provider connection fields and returns null for a deleted Scout", async () => {
    const backend = testBackend();
    const scoutId = await backend.run(async (ctx) => await ctx.db.insert("scouts", scoutFields));

    await expect(backend.query(scoutsApi["getConnections"], { scoutId })).resolves.toEqual({
      agentMail: { inboxId: "test-inbox-scout" },
      firecrawl: { profileName: "test-scout-profile" },
    });

    await backend.run(async (ctx) => await ctx.db.patch(scoutId, { status: "disabled" }));
    await expect(backend.query(scoutsApi["getConnections"], { scoutId })).resolves.toBeNull();
    await backend.run(async (ctx) => await ctx.db.patch(scoutId, { status: "active" }));
    await backend.run(async (ctx) => await ctx.db.delete(scoutId));
    await expect(backend.query(scoutsApi["getConnections"], { scoutId })).resolves.toBeNull();
  });

  it("rejects invalid scout fields and duplicate canonical AgentMail addresses", async () => {
    const backend = testBackend();
    await backend.mutation(scoutsApi["upsert"], scoutFields);

    await expect(
      backend.mutation(scoutsApi["upsert"], {
        ...scoutFields,
        slug: "other",
        agentMail: { ...scoutFields.agentMail, address: " TEST-SCOUT@EXAMPLE.TEST " },
      }),
    ).rejects.toThrow("already registered");
    await expect(
      backend.mutation(scoutsApi["upsert"], {
        ...scoutFields,
        slug: "other",
        agentMail: { ...scoutFields.agentMail, address: "other@example.test" },
        firecrawl: { profileName: "other-profile" },
      }),
    ).rejects.toThrow("AgentMail inbox is already registered");
    await expect(
      backend.mutation(scoutsApi["upsert"], {
        ...scoutFields,
        slug: "other",
        agentMail: { inboxId: "other-inbox", address: "other@example.test" },
      }),
    ).rejects.toThrow("Firecrawl profile is already registered");
    await expect(
      backend.mutation(scoutsApi["upsert"], {
        ...scoutFields,
        agentMail: { ...scoutFields.agentMail, address: "not-an-email" },
      }),
    ).rejects.toThrow("valid email");
    await expect(
      backend.mutation(scoutsApi["upsert"], { ...scoutFields, slug: "bad slug" }),
    ).rejects.toThrow("Scout slug");
    await expect(
      backend.mutation(scoutsApi["upsert"], {
        ...scoutFields,
        displayName: "x".repeat(101),
      }),
    ).rejects.toThrow("display name");
    await expect(
      backend.mutation(scoutsApi["upsert"], {
        ...scoutFields,
        websiteIdentity: { firstName: "  ", lastName: "Scout" },
      }),
    ).rejects.toThrow("first name");
    await expect(
      backend.mutation(scoutsApi["upsert"], {
        ...scoutFields,
        websiteIdentity: { firstName: "Conrad", lastName: "x".repeat(101) },
      }),
    ).rejects.toThrow("last name");
  });

  it("does not steal runs owned by another Scout", async () => {
    const backend = testBackend();
    const otherScoutId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scouts", {
          ...scoutFields,
          slug: "other",
          agentMail: { inboxId: "other-inbox", address: "other@example.test" },
          firecrawl: { profileName: "other-profile" },
        }),
    );
    const runIds = await backend.run(async (ctx) => {
      const unlinkedRunId = await ctx.db.insert("scoutRuns", {
        scoutName: "Test Scout",
        scoutEmail: scoutFields.agentMail.address,
        targetUrl: "https://example.com/one",
        mission: "First mission",
        status: { kind: "pending" },
        browser: { kind: "none" },
        createdAt: 1,
        updatedAt: 1,
      });
      const ownedRunId = await ctx.db.insert("scoutRuns", {
        scoutName: "Test Scout",
        scoutEmail: scoutFields.agentMail.address,
        scoutId: otherScoutId,
        targetUrl: "https://example.com/two",
        mission: "Second mission",
        status: { kind: "pending" },
        browser: { kind: "none" },
        createdAt: 2,
        updatedAt: 2,
      });
      return { unlinkedRunId, ownedRunId };
    });

    const result = await backend.mutation(scoutsApi["upsert"], scoutFields);
    expect(result).toMatchObject({ linkedRunCount: 1, linkLimitReached: false });
    await expect(
      backend.run(async (ctx) => {
        const [unlinkedRun, ownedRun] = await Promise.all([
          ctx.db.get("scoutRuns", runIds.unlinkedRunId),
          ctx.db.get("scoutRuns", runIds.ownedRunId),
        ]);
        return { unlinkedRun, ownedRun };
      }),
    ).resolves.toMatchObject({
      unlinkedRun: { scoutId: result.scoutId },
      ownedRun: { scoutId: otherScoutId },
    });
  });

  it("links more than 101 legacy runs resumably across calls", async () => {
    const backend = testBackend();
    await backend.run(async (ctx) => {
      for (let index = 0; index < 205; index += 1) {
        await ctx.db.insert("scoutRuns", {
          scoutName: "Test Scout",
          scoutEmail: scoutFields.agentMail.address,
          targetUrl: "https://example.com/target",
          mission: `Mission ${index}`,
          status: { kind: "pending" },
          browser: { kind: "none" },
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    const first = await backend.mutation(scoutsApi["upsert"], scoutFields);
    const second = await backend.mutation(scoutsApi["upsert"], scoutFields);
    const third = await backend.mutation(scoutsApi["upsert"], scoutFields);
    const fourth = await backend.mutation(scoutsApi["upsert"], scoutFields);
    expect([first, second, third, fourth].map((result) => result.linkedRunCount)).toEqual([
      100, 100, 5, 0,
    ]);
    expect([first, second, third, fourth].map((result) => result.linkLimitReached)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    await expect(
      backend.run(async (ctx) =>
        ctx.db
          .query("scoutRuns")
          .withIndex("by_scout_email_and_scout_id_and_created_at", (q) =>
            q.eq("scoutEmail", scoutFields.agentMail.address).eq("scoutId", undefined),
          )
          .take(1),
      ),
    ).resolves.toEqual([]);
  });
});
