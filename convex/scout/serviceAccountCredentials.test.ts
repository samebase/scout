import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { ADMIN_EMAIL } from "../authConfig";
import schema from "../schema";

const modules = {
  ...import.meta.glob("../**/*.*s"),
  ...Object.fromEntries(
    Object.entries(
      import.meta.glob(["./serviceAccountCredentials.ts", "./serviceAccounts.ts"]),
    ).map(([path, module]) => [`../scout/${path.slice(2)}`, module]),
  ),
};
const credentialsApi = anyApi["scout"]["serviceAccountCredentials"];
const serviceAccountsApi = anyApi["scout"]["serviceAccounts"];

function testBackend() {
  return convexTest(schema, modules);
}

async function authenticatedBackend() {
  const backend = testBackend();
  const userId = await backend.run(
    async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
  );
  const scoutId = await backend.run(
    async (ctx) =>
      await ctx.db.insert("scouts", {
        displayName: "Conrad Scout",
        websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
        slug: "conrad",
        status: "active",
        agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
        firecrawl: { profileName: "conrad-profile" },
      }),
  );
  return {
    backend,
    scoutId,
    admin: backend.withIdentity({ subject: `${userId}|test-session` }),
  };
}

function registration(scoutId: string) {
  return {
    scoutId,
    serviceName: "Example",
    serviceDomain: "www.example.com",
    credentialHost: "accounts.example.com",
    identifier: "conrad@example.test",
  };
}

function encryptedCredential(fingerprint = "key-fingerprint-one") {
  return {
    credentialReference: crypto.randomUUID(),
    formatVersion: 1 as const,
    algorithm: "aes-256-gcm" as const,
    keyVersion: 1 as const,
    keyFingerprint: fingerprint,
    nonce: "nonce",
    ciphertext: "ciphertext",
    authenticationTag: "authentication-tag",
  };
}

describe("Scout managed-credential persistence", () => {
  test("authenticates before preparing or committing a credential", async () => {
    const { backend, scoutId } = await authenticatedBackend();
    const args = registration(scoutId);

    await expect(backend.query(credentialsApi["prepareManagedRegistration"], args)).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      backend.mutation(credentialsApi["commitManagedRegistration"], {
        ...args,
        encryptedCredential: encryptedCredential(),
      }),
    ).rejects.toThrow("Not authorized");
    await expect(
      backend.run(async (ctx) => await ctx.db.query("scoutManagedCredentials").collect()),
    ).resolves.toEqual([]);
  });

  test("keeps product grouping separate from the exact credential host and projects no envelope", async () => {
    const { admin, scoutId } = await authenticatedBackend();
    const args = registration(scoutId);

    await expect(admin.query(credentialsApi["prepareManagedRegistration"], args)).resolves.toEqual({
      scoutId,
      serviceName: "Example",
      serviceDomain: "example.com",
      credentialHost: "accounts.example.com",
      identifier: "conrad@example.test",
    });
    const result = await admin.mutation(credentialsApi["commitManagedRegistration"], {
      ...args,
      encryptedCredential: encryptedCredential(),
    });

    await expect(admin.query(serviceAccountsApi["list"], { scoutId })).resolves.toEqual([
      {
        _id: result.serviceAccountId,
        scoutId,
        serviceName: "Example",
        serviceDomain: "example.com",
        identifier: "conrad@example.test",
        authenticationEvidence: { kind: "none" },
        firstRecordedByClaimTest: null,
        lastVerifiedByClaimTest: null,
        managedCredential: result.managedCredential,
      },
    ]);
    expect(
      JSON.stringify(await admin.query(serviceAccountsApi["list"], { scoutId })),
    ).not.toContain("ciphertext");
  });

  test("resolves only the exact bound service-account credential", async () => {
    const { admin, scoutId } = await authenticatedBackend();
    const firstEnvelope = encryptedCredential();
    const first = await admin.mutation(credentialsApi["commitManagedRegistration"], {
      ...registration(scoutId),
      encryptedCredential: firstEnvelope,
    });
    const secondEnvelope = encryptedCredential();
    const second = await admin.mutation(credentialsApi["commitManagedRegistration"], {
      ...registration(scoutId),
      serviceName: "Other",
      serviceDomain: "other.example",
      credentialHost: "login.other.example",
      identifier: "other@example.test",
      encryptedCredential: secondEnvelope,
    });

    await expect(
      admin.query(credentialsApi["getRuntimeCredential"], {
        serviceAccountId: first.serviceAccountId,
      }),
    ).resolves.toMatchObject({
      serviceAccountId: first.serviceAccountId,
      credentialReference: firstEnvelope.credentialReference,
      credentialHost: "accounts.example.com",
      identifier: "conrad@example.test",
    });
    await expect(
      admin.query(credentialsApi["getRuntimeCredential"], {
        serviceAccountId: second.serviceAccountId,
      }),
    ).resolves.toMatchObject({
      serviceAccountId: second.serviceAccountId,
      credentialReference: secondEnvelope.credentialReference,
      credentialHost: "login.other.example",
      identifier: "other@example.test",
    });
  });

  test("rejects a bound account without a managed credential", async () => {
    const { admin, scoutId } = await authenticatedBackend();
    const external = await admin.mutation(serviceAccountsApi["register"], {
      scoutId,
      serviceName: "External",
      serviceDomain: "external.example",
      identifier: "external@example.test",
    });

    await expect(
      admin.query(credentialsApi["getRuntimeCredential"], {
        serviceAccountId: external.serviceAccountId,
      }),
    ).rejects.toThrow("no managed credential");
  });

  test("fails closed when the version-one key changes", async () => {
    const { admin, backend, scoutId } = await authenticatedBackend();
    await admin.mutation(credentialsApi["commitManagedRegistration"], {
      ...registration(scoutId),
      encryptedCredential: encryptedCredential("fingerprint-one"),
    });

    await expect(
      admin.mutation(credentialsApi["commitManagedRegistration"], {
        ...registration(scoutId),
        serviceDomain: "another.example",
        credentialHost: "login.another.example",
        identifier: "second@example.test",
        encryptedCredential: encryptedCredential("fingerprint-two"),
      }),
    ).rejects.toThrow("credential key does not match configured version");
    await expect(
      backend.run(async (ctx) => await ctx.db.query("scoutManagedCredentials").collect()),
    ).resolves.toHaveLength(1);
  });

  test("refuses to repin a missing registry while encrypted rows still exist", async () => {
    const { admin, backend, scoutId } = await authenticatedBackend();
    await admin.mutation(credentialsApi["commitManagedRegistration"], {
      ...registration(scoutId),
      encryptedCredential: encryptedCredential("fingerprint-one"),
    });
    await backend.run(async (ctx) => {
      const key = await ctx.db.query("scoutCredentialKeys").first();
      if (key) await ctx.db.delete(key._id);
    });

    await expect(
      admin.mutation(credentialsApi["commitManagedRegistration"], {
        ...registration(scoutId),
        serviceDomain: "another.example",
        credentialHost: "login.another.example",
        identifier: "second@example.test",
        encryptedCredential: encryptedCredential("fingerprint-two"),
      }),
    ).rejects.toThrow("key registry is missing for existing credentials");
  });
});
