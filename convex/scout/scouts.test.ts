import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { anyApi } from "convex/server";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import schema from "../schema";

const modules = {
  ...import.meta.glob("../**/*.*s"),
  ...Object.fromEntries(
    Object.entries({
      ...import.meta.glob("./scouts.ts"),
      ...import.meta.glob("./scoutRegistration.ts"),
    }).map(([path, module]) => [`../scout/${path.slice(2)}`, module]),
  ),
};
const scoutsApi = anyApi["scout"]["scouts"];
const scoutRegistrationApi = anyApi["scout"]["scoutRegistration"];

function testBackend() {
  return convexTest(schema, modules);
}

async function insertUser(backend: ReturnType<typeof testBackend>, email: string) {
  return await backend.run(async (ctx) => await insertTestAccount(ctx, { email }));
}

const scoutRegistrationFields = {
  displayName: "Test Scout",
  websiteIdentity: {
    firstName: "Conrad",
    lastName: "Scout",
  },
  slug: "conrad",
  agentMail: {
    inboxId: "test-scout@example.test",
    address: "test-scout@example.test",
  },
  firecrawl: {
    profileName: "test-scout-profile",
  },
};

beforeEach(() => {
  vi.stubEnv("AGENTMAIL_API_KEY", "agentmail-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const inboxId = decodeURIComponent(new URL(requestUrl).pathname.split("/").at(-1) ?? "");
      return new Response(JSON.stringify({ inbox_id: inboxId, email: inboxId }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Scout registry", () => {
  it.each([undefined, "   "])(
    "returns a public error when AgentMail is not configured: %s",
    async (apiKey) => {
      vi.stubEnv("AGENTMAIL_API_KEY", apiKey);
      const backend = testBackend();
      const adminId = await insertUser(backend, ADMIN_EMAIL);
      const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
      const registration = admin.action(scoutRegistrationApi["register"], scoutRegistrationFields);
      await expect(registration).rejects.toBeInstanceOf(ConvexError);
      await expect(registration).rejects.toMatchObject({
        data: "Scout email is not configured on this deployment. Ask the administrator to configure AgentMail.",
      });
      expect(fetch).not.toHaveBeenCalled();
      await expect(admin.query(scoutsApi["list"], {})).resolves.toEqual([]);
    },
  );

  it("rejects unauthenticated and non-admin access", async () => {
    const backend = testBackend();

    await expect(backend.query(scoutsApi["list"], {})).rejects.toThrow("Not authorized");
    await expect(backend.query(scoutsApi["get"], { slug: "conrad" })).rejects.toThrow(
      "Not authorized",
    );
    await expect(
      backend.action(scoutRegistrationApi["register"], scoutRegistrationFields),
    ).rejects.toThrow("Not authorized");

    const nonAdminId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${nonAdminId}|test-session` });
    await expect(
      nonAdmin.action(scoutRegistrationApi["register"], scoutRegistrationFields),
    ).rejects.toThrow("Not authorized");
  });

  it("registers a canonical Scout and exposes exact public and runtime projections", async () => {
    const backend = testBackend();
    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });

    const result = await admin.action(scoutRegistrationApi["register"], {
      ...scoutRegistrationFields,
      displayName: "  Test Scout  ",
      websiteIdentity: {
        firstName: "  Conrad  ",
        lastName: "  Scout  ",
      },
      slug: "  CONRAD  ",
      agentMail: {
        inboxId: "  test-scout@example.test  ",
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
        inboxId: "test-scout@example.test",
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

    await expect(admin.action(scoutRegistrationApi["register"], missingIdentity)).rejects.toThrow(
      "websiteIdentity",
    );
    await expect(
      admin.action(scoutRegistrationApi["register"], {
        ...missingIdentity,
        websiteIdentity: { firstName: "Conrad" },
      }),
    ).rejects.toThrow("lastName");

    await admin.action(scoutRegistrationApi["register"], scoutRegistrationFields);
    await expect(
      admin.action(scoutRegistrationApi["register"], scoutRegistrationFields),
    ).rejects.toThrow("slug is already registered");
  });

  it("rejects invalid fields and duplicate provider identities", async () => {
    const backend = testBackend();
    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    await admin.action(scoutRegistrationApi["register"], scoutRegistrationFields);

    await expect(
      admin.action(scoutRegistrationApi["register"], {
        ...scoutRegistrationFields,
        slug: "other",
        agentMail: {
          inboxId: "other@example.test",
          address: " TEST-SCOUT@EXAMPLE.TEST ",
        },
        firecrawl: { profileName: "other-profile" },
      }),
    ).rejects.toThrow("AgentMail address is already registered");
    await expect(
      admin.action(scoutRegistrationApi["register"], {
        ...scoutRegistrationFields,
        slug: "other",
        agentMail: { inboxId: "test-scout@example.test", address: "other@example.test" },
        firecrawl: { profileName: "other-profile" },
      }),
    ).rejects.toThrow("AgentMail inbox is already registered");
    await expect(
      admin.action(scoutRegistrationApi["register"], {
        ...scoutRegistrationFields,
        slug: "other",
        agentMail: { inboxId: "other@example.test", address: "other@example.test" },
      }),
    ).rejects.toThrow("Firecrawl profile is already registered");
    await expect(
      admin.action(scoutRegistrationApi["register"], {
        ...scoutRegistrationFields,
        agentMail: { ...scoutRegistrationFields.agentMail, address: "not-an-email" },
      }),
    ).rejects.toThrow("valid email");
    await expect(
      admin.action(scoutRegistrationApi["register"], {
        ...scoutRegistrationFields,
        slug: "bad slug",
      }),
    ).rejects.toThrow("Scout slug");
    await expect(
      admin.action(scoutRegistrationApi["register"], {
        ...scoutRegistrationFields,
        displayName: "x".repeat(101),
      }),
    ).rejects.toThrow("display name");
    await expect(
      admin.action(scoutRegistrationApi["register"], {
        ...scoutRegistrationFields,
        websiteIdentity: { firstName: "  ", lastName: "Scout" },
      }),
    ).rejects.toThrow("first name");
    await expect(
      admin.action(scoutRegistrationApi["register"], {
        ...scoutRegistrationFields,
        websiteIdentity: { firstName: "Conrad", lastName: "x".repeat(101) },
      }),
    ).rejects.toThrow("last name");
  });

  it("rejects registration when AgentMail reports a different inbox address", async () => {
    const backend = testBackend();
    const adminId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${adminId}|test-session` });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              inbox_id: scoutRegistrationFields.agentMail.inboxId,
              email: "another-scout@example.test",
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      admin.action(scoutRegistrationApi["register"], scoutRegistrationFields),
    ).rejects.toThrow("inbox ID and address do not identify the same inbox");
    await expect(admin.query(scoutsApi["list"], {})).resolves.toEqual([]);
  });
});
