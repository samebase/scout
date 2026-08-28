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

const scoutRegistrationFields = {
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
  firecrawl: {
    profileName: "test-scout-profile",
  },
};

describe("Scout registry", () => {
  it("rejects unauthenticated and non-admin access", async () => {
    const backend = testBackend();

    await expect(backend.query(scoutsApi["list"], {})).rejects.toThrow("Not authorized");
    await expect(backend.query(scoutsApi["get"], { slug: "conrad" })).rejects.toThrow(
      "Not authorized",
    );
    await expect(backend.mutation(scoutsApi["register"], scoutRegistrationFields)).rejects.toThrow(
      "Not authorized",
    );

    const nonAdminId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(nonAdmin.mutation(scoutsApi["register"], scoutRegistrationFields)).rejects.toThrow(
      "Not authorized",
    );
  });

  it("registers a canonical Scout and exposes exact public and runtime projections", async () => {
    const backend = testBackend();
    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });

    const result = await admin.mutation(scoutsApi["register"], {
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
      firecrawl: { profileName: "  test-scout-profile  " },
    });
    expect(result).toEqual({ scoutId: expect.any(String) });

    const expectedScout = {
      _id: result.scoutId,
      displayName: "Test Scout",
      websiteIdentity: {
        firstName: "Conrad",
        lastName: "Scout",
      },
      slug: "conrad",
      status: "active",
      agentMail: {
        inboxId: "test-inbox-scout",
        address: "test-scout@example.test",
      },
      firecrawl: { profileName: "test-scout-profile" },
    };
    await expect(admin.query(scoutsApi["list"], {})).resolves.toEqual([expectedScout]);
    await expect(admin.query(scoutsApi["get"], { slug: "  CONRAD  " })).resolves.toEqual(
      expectedScout,
    );
    await expect(
      backend.query(scoutsApi["getRuntimeIdentity"], { scoutId: result.scoutId }),
    ).resolves.toEqual({
      displayName: expectedScout.displayName,
      websiteIdentity: expectedScout.websiteIdentity,
      status: expectedScout.status,
      agentMail: expectedScout.agentMail,
      firecrawl: expectedScout.firecrawl,
    });
    await expect(admin.query(scoutsApi["get"], { slug: "missing" })).resolves.toBeNull();
  });

  it("requires a complete website identity and keeps registration create-only", async () => {
    const backend = testBackend();
    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    const { websiteIdentity: _websiteIdentity, ...missingIdentity } = scoutRegistrationFields;

    await expect(admin.mutation(scoutsApi["register"], missingIdentity)).rejects.toThrow(
      "websiteIdentity",
    );
    await expect(
      admin.mutation(scoutsApi["register"], {
        ...missingIdentity,
        websiteIdentity: { firstName: "Conrad" },
      }),
    ).rejects.toThrow("lastName");

    await admin.mutation(scoutsApi["register"], scoutRegistrationFields);
    await expect(admin.mutation(scoutsApi["register"], scoutRegistrationFields)).rejects.toThrow(
      "slug is already registered",
    );
  });

  it("rejects invalid fields and duplicate provider identities", async () => {
    const backend = testBackend();
    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    await admin.mutation(scoutsApi["register"], scoutRegistrationFields);

    await expect(
      admin.mutation(scoutsApi["register"], {
        ...scoutRegistrationFields,
        slug: "other",
        agentMail: {
          inboxId: "other-inbox",
          address: " TEST-SCOUT@EXAMPLE.TEST ",
        },
        firecrawl: { profileName: "other-profile" },
      }),
    ).rejects.toThrow("AgentMail address is already registered");
    await expect(
      admin.mutation(scoutsApi["register"], {
        ...scoutRegistrationFields,
        slug: "other",
        agentMail: { inboxId: "test-inbox-scout", address: "other@example.test" },
        firecrawl: { profileName: "other-profile" },
      }),
    ).rejects.toThrow("AgentMail inbox is already registered");
    await expect(
      admin.mutation(scoutsApi["register"], {
        ...scoutRegistrationFields,
        slug: "other",
        agentMail: { inboxId: "other-inbox", address: "other@example.test" },
      }),
    ).rejects.toThrow("Firecrawl profile is already registered");
    await expect(
      admin.mutation(scoutsApi["register"], {
        ...scoutRegistrationFields,
        agentMail: { ...scoutRegistrationFields.agentMail, address: "not-an-email" },
      }),
    ).rejects.toThrow("valid email");
    await expect(
      admin.mutation(scoutsApi["register"], { ...scoutRegistrationFields, slug: "bad slug" }),
    ).rejects.toThrow("Scout slug");
    await expect(
      admin.mutation(scoutsApi["register"], {
        ...scoutRegistrationFields,
        displayName: "x".repeat(101),
      }),
    ).rejects.toThrow("display name");
    await expect(
      admin.mutation(scoutsApi["register"], {
        ...scoutRegistrationFields,
        websiteIdentity: { firstName: "  ", lastName: "Scout" },
      }),
    ).rejects.toThrow("first name");
    await expect(
      admin.mutation(scoutsApi["register"], {
        ...scoutRegistrationFields,
        websiteIdentity: { firstName: "Conrad", lastName: "x".repeat(101) },
      }),
    ).rejects.toThrow("last name");
  });
});
