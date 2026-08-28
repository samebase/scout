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
    const accountId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scoutServiceAccounts", {
          scoutId,
          serviceName: "Tally",
          serviceDomain: "tally.so",
          identifier: "conrad@example.test",
          authenticationEvidence: { kind: "none" },
        }),
    );
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
    await expect(
      backend.mutation(serviceAccountsApi["recordAuthentication"], {
        serviceAccountId: accountId,
        outcome: "succeeded",
      }),
    ).rejects.toThrow("Not authorized");

    const nonAdminId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(nonAdmin.query(serviceAccountsApi["list"], {})).rejects.toThrow("Not authorized");
    await expect(nonAdmin.mutation(serviceAccountsApi["register"], registration)).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      nonAdmin.mutation(serviceAccountsApi["recordAuthentication"], {
        serviceAccountId: accountId,
        outcome: "failed",
      }),
    ).rejects.toThrow("Not authorized");
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
        identifier: "conrad@agentmail.to",
        authenticationEvidence: { kind: "none" },
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

  it("rejects canonical duplicates while allowing distinct accounts", async () => {
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
        identifier: "CONRAD@EXAMPLE.TEST",
      }),
    ).rejects.toThrow("already registered");
    await expect(
      admin.mutation(serviceAccountsApi["register"], {
        ...first,
        identifier: "second@example.test",
      }),
    ).resolves.toEqual({ serviceAccountId: expect.any(String) });
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

  it("records authentication evidence and preserves the last success", async () => {
    const { backend, admin } = await authenticatedBackend();
    const scoutId = await insertScout(backend, "conrad");
    const { serviceAccountId } = await admin.mutation(serviceAccountsApi["register"], {
      scoutId,
      serviceName: "Tally",
      serviceDomain: "tally.so",
      identifier: "conrad@example.test",
    });

    await admin.mutation(serviceAccountsApi["recordAuthentication"], {
      serviceAccountId,
      outcome: "failed",
    });
    let [account] = await admin.query(serviceAccountsApi["list"], { scoutId });
    expect(account.authenticationEvidence).toEqual({
      kind: "failed",
      checkedAt: expect.any(Number),
    });

    await admin.mutation(serviceAccountsApi["recordAuthentication"], {
      serviceAccountId,
      outcome: "succeeded",
    });
    [account] = await admin.query(serviceAccountsApi["list"], { scoutId });
    expect(account.authenticationEvidence).toMatchObject({
      kind: "succeeded",
      checkedAt: expect.any(Number),
    });
    if (account.authenticationEvidence.kind !== "succeeded") {
      throw new Error("Expected successful authentication evidence");
    }
    const lastSucceededAt = account.authenticationEvidence.checkedAt;

    await admin.mutation(serviceAccountsApi["recordAuthentication"], {
      serviceAccountId,
      outcome: "failed",
    });
    [account] = await admin.query(serviceAccountsApi["list"], { scoutId });
    expect(account.authenticationEvidence).toMatchObject({
      kind: "failed",
      checkedAt: expect.any(Number),
      lastSucceededAt,
    });

    await admin.mutation(serviceAccountsApi["recordAuthentication"], {
      serviceAccountId,
      outcome: "failed",
    });
    [account] = await admin.query(serviceAccountsApi["list"], { scoutId });
    expect(account.authenticationEvidence).toMatchObject({
      kind: "failed",
      lastSucceededAt,
    });
  });
});
