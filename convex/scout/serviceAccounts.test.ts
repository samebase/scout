import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { ADMIN_EMAIL } from "../authConfig";
import schema from "../schema";

const modules = {
  ...import.meta.glob("../**/*.*s"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./serviceAccounts.ts")).map(([path, module]) => [
      `../scout/${path.slice(2)}`,
      module,
    ]),
  ),
};
const serviceAccountsApi = anyApi["scout"]["serviceAccounts"];

function testBackend() {
  return convexTest(schema, modules);
}

async function insertUser(backend: ReturnType<typeof testBackend>, email: string) {
  return await backend.run(async (ctx) => await ctx.db.insert("users", { email }));
}

async function insertScout(backend: ReturnType<typeof testBackend>, slug: string) {
  return await backend.run(
    async (ctx) =>
      await ctx.db.insert("scouts", {
        displayName: `${slug} Scout`,
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

async function authenticatedBackend() {
  const backend = testBackend();
  const adminId = await insertUser(backend, ADMIN_EMAIL);
  return {
    backend,
    admin: backend.withIdentity({ subject: `${adminId}|test-session` }),
  };
}

describe("Scout service-account inventory", () => {
  it("rejects unauthenticated and non-admin access", async () => {
    const backend = testBackend();
    const scoutId = await insertScout(backend, "conrad");
    const registration = {
      scoutId,
      serviceName: "Tally",
      serviceDomain: "tally.so",
      identifier: "other@example.test",
    };

    await expect(backend.query(serviceAccountsApi["list"], {})).rejects.toThrow("Not authorized");
    await expect(backend.mutation(serviceAccountsApi["register"], registration)).rejects.toThrow(
      "Not authorized",
    );

    const nonAdminId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(nonAdmin.query(serviceAccountsApi["list"], {})).rejects.toThrow("Not authorized");
    await expect(nonAdmin.mutation(serviceAccountsApi["register"], registration)).rejects.toThrow(
      "Not authorized",
    );
  });

  it("normalizes registration fields and returns safe projections", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");

    const result = await admin.mutation(serviceAccountsApi["register"], {
      scoutId,
      serviceName: "  Tally  ",
      serviceDomain: "  HTTPS://TALLY.SO/forms/example  ",
      identifier: "  CONRAD@AGENTMAIL.TO  ",
    });

    await expect(admin.query(serviceAccountsApi["list"], { scoutId })).resolves.toEqual([
      {
        _id: result.serviceAccountId,
        scoutId,
        serviceName: "Tally",
        serviceDomain: "tally.so",
        identifier: "CONRAD@AGENTMAIL.TO",
        authenticationEvidence: { kind: "none" },
        firstRecordedByClaimTest: null,
        lastVerifiedByClaimTest: null,
      },
    ]);
  });

  it("requires an existing Scout", async () => {
    const { backend, admin } = await authenticatedBackend();
    const missingScoutId = await insertScout(backend, "temporary");
    await backend.run(async (ctx) => await ctx.db.delete(missingScoutId));

    await expect(
      admin.mutation(serviceAccountsApi["register"], {
        scoutId: missingScoutId,
        serviceName: "Tally",
        serviceDomain: "tally.so",
        identifier: "conrad@example.test",
      }),
    ).rejects.toThrow("Scout not found");
  });

  it("rejects canonical domain duplicates while preserving identifier case", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    const first = {
      scoutId,
      serviceName: "Tally",
      serviceDomain: "tally.so",
      identifier: "conrad@example.test",
    };
    await admin.mutation(serviceAccountsApi["register"], first);

    await expect(
      admin.mutation(serviceAccountsApi["register"], {
        ...first,
        serviceName: "Tally Forms",
        serviceDomain: "HTTPS://TALLY.SO/",
        identifier: "  conrad@example.test  ",
      }),
    ).rejects.toThrow("already registered");
    await expect(
      admin.mutation(serviceAccountsApi["register"], {
        ...first,
        identifier: "CONRAD@EXAMPLE.TEST",
      }),
    ).resolves.toEqual({ serviceAccountId: expect.any(String) });
  });

  it.each([
    "foo..com",
    "foo_bar.com",
    "-foo.com",
    "foo-.com",
    `${"a".repeat(64)}.com`,
    `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
  ])("rejects an invalid service domain: %s", async (serviceDomain) => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");

    await expect(
      admin.mutation(serviceAccountsApi["register"], {
        scoutId,
        serviceName: "Example",
        serviceDomain,
        identifier: "conrad@example.test",
      }),
    ).rejects.toThrow("Service domain must be a valid hostname or URL");
  });

  it("filters accounts by Scout", async () => {
    const { backend, admin } = await authenticatedBackend();
    const conradId = await insertScout(backend, "conrad");
    const adaId = await insertScout(backend, "ada");
    await admin.mutation(serviceAccountsApi["register"], {
      scoutId: conradId,
      serviceName: "Tally",
      serviceDomain: "tally.so",
      identifier: "conrad@example.test",
    });
    await admin.mutation(serviceAccountsApi["register"], {
      scoutId: adaId,
      serviceName: "GitHub",
      serviceDomain: "github.com",
      identifier: "ada-scout",
    });

    const conradAccounts = await admin.query(serviceAccountsApi["list"], { scoutId: conradId });
    expect(conradAccounts).toHaveLength(1);
    expect(conradAccounts[0]).toMatchObject({ scoutId: conradId, serviceName: "Tally" });
    const allAccounts = await admin.query(serviceAccountsApi["list"], {});
    expect(allAccounts).toHaveLength(2);
    expect(new Set(allAccounts.map((account: { scoutId: string }) => account.scoutId))).toEqual(
      new Set([conradId, adaId]),
    );
  });

  it("rejects a fifty-first account before it can disappear from a Scout list", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    await backend.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId,
          serviceName: `Service ${index}`,
          serviceDomain: `service-${index}.example`,
          identifier: `account-${index}`,
          authenticationEvidence: { kind: "none" },
        });
      }
    });

    await expect(admin.query(serviceAccountsApi["list"], { scoutId })).resolves.toHaveLength(50);
    await expect(
      admin.mutation(serviceAccountsApi["register"], {
        scoutId,
        serviceName: "Hidden service",
        serviceDomain: "hidden.example",
        identifier: "hidden-account",
      }),
    ).rejects.toThrow("A Scout can have at most 50 service accounts");
  });

  it("rejects a two-hundred-and-first account before it can disappear from the global list", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutIds = await Promise.all(
      Array.from({ length: 5 }, (_, index) => insertScout(backend, `scout-${index}`)),
    );
    await backend.run(async (ctx) => {
      for (let index = 0; index < 200; index += 1) {
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId: scoutIds[Math.floor(index / 50)],
          serviceName: `Service ${index}`,
          serviceDomain: `service-${index}.example`,
          identifier: `account-${index}`,
          authenticationEvidence: { kind: "none" },
        });
      }
    });

    await expect(admin.query(serviceAccountsApi["list"], {})).resolves.toHaveLength(200);
    await expect(
      admin.mutation(serviceAccountsApi["register"], {
        scoutId: scoutIds[4],
        serviceName: "Hidden service",
        serviceDomain: "hidden.example",
        identifier: "hidden-account",
      }),
    ).rejects.toThrow("Service account inventory can contain at most 200 accounts");
  });
});
