/// <reference types="vite/client" />
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { registerCore } from "@convex-dev/auth/test";
import { registerEmail } from "@convex-dev/auth/components/email/test";
import { registerPasswordProvider } from "@convex-dev/auth/components/password/test";
import { convexTest } from "convex-test";
import { createFunctionHandle } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import { createEmailPasswordAccount, readHubProfile, setNewPassword } from "./auth";
import { ADMIN_EMAIL } from "./testing/accounts";

// convex/auth.ts sets up Google sign-in when it loads, with the hub's issuer and the deployment's
// site URLs, so they come before the imports.
vi.hoisted(() => {
  vi.stubEnv("HUB_ISSUER", "https://hub.example.test");
  vi.stubEnv("SITE_URL", "https://scout-test.convex.site");
  vi.stubEnv("CONVEX_SITE_URL", "https://scout-test.convex.site");
});

// The sign-up and recovery links run in the email component, whose limits read the client address
// through `ctx.meta.getRequestMetadata()`. convex-test 0.0.57 has no request metadata, so those
// flows are checked against a deployment; these tests cover Scout's own functions.
const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 0x10001 });
  const pem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  vi.stubEnv("CONVEX_SITE_URL", "https://scout-test.convex.site");
  vi.stubEnv("SITE_URL", "https://scout-test.convex.site");
  vi.stubEnv("AUTH_PRIVATE_KEY", Buffer.from(pem).toString("base64"));
  vi.stubEnv(
    "AUTH_JWKS",
    JSON.stringify({
      keys: [
        {
          ...pair.publicKey.export({ format: "jwk" }),
          kid: randomUUID(),
          alg: "RS256",
          use: "sig",
        },
      ],
    }),
  );
  vi.stubEnv("DEV_SEED_AUTH_ENABLED", "true");
  vi.stubEnv("DEV_SEED_AUTH_EMAIL", "Preview@Example.com");
  vi.stubEnv("DEV_SEED_AUTH_PASSWORD", "preview-password-123");
});
afterEach(() => vi.unstubAllEnvs());

function setup() {
  const backend = convexTest(schema, modules);
  registerCore(backend);
  registerPasswordProvider(backend);
  registerEmail(backend);
  return backend;
}

function signIn(backend: ReturnType<typeof setup>, email: string, password: string) {
  return backend.mutation(api.auth.signInWithEmailPassword, { email, password });
}

test("the seeded development account signs in without a link and follows its password", async () => {
  const backend = setup();
  expect(await backend.mutation(internal.devAuth.seedPasswordAccount, {})).toEqual({
    created: true,
    email: "preview@example.com",
  });
  const seed = await signIn(backend, " PREVIEW@example.com", "preview-password-123");
  if (seed.status !== "complete") throw new Error("Expected the seed account to sign in");
  const userId = seed.tokens.userId;
  expect(await backend.run((ctx) => ctx.db.query("users").collect())).toEqual([
    expect.objectContaining({
      _id: userId,
      email: "preview@example.com",
      emailVerificationTime: expect.any(Number),
      isApproved: true,
    }),
  ]);
  // The first sign-in creates the credit wallet.
  expect(await backend.run((ctx) => ctx.db.query("creditWallets").collect())).toEqual([
    expect.objectContaining({ userId }),
  ]);

  vi.stubEnv("DEV_SEED_AUTH_PASSWORD", "replacement-password-456");
  expect(await backend.mutation(internal.devAuth.seedPasswordAccount, {})).toEqual({
    created: false,
    email: "preview@example.com",
  });
  expect(await signIn(backend, "preview@example.com", "preview-password-123")).toEqual({
    status: "error",
    userError: { error: "INVALID_CREDENTIALS" },
  });
  expect(await signIn(backend, "preview@example.com", "replacement-password-456")).toMatchObject({
    status: "complete",
    tokens: { userId },
  });

  vi.stubEnv("DEV_SEED_AUTH_ENABLED", "false");
  await expect(backend.mutation(internal.devAuth.seedPasswordAccount, {})).rejects.toThrow(
    "disabled",
  );
});

test("the seed refuses a production deployment", async () => {
  const backend = setup();
  vi.stubEnv("CONVEX_DEPLOYMENT", "prod:scout-test");
  await expect(backend.mutation(internal.devAuth.seedPasswordAccount, {})).rejects.toThrow(
    "disabled in production",
  );
});

test("an account from before Convex Auth 2 signs in once a recovery link gave it an account", async () => {
  const backend = setup();
  const legacyId = await backend.run((ctx) =>
    ctx.db.insert("users", {
      email: ADMIN_EMAIL,
      emailVerificationTime: 1,
      isApproved: true,
      termsAcceptedAt: 1,
    }),
  );
  // Its old password did not carry over, so it has no email-password account yet.
  expect(await signIn(backend, ADMIN_EMAIL, "admin-password-123")).toEqual({
    status: "error",
    userError: { error: "INVALID_CREDENTIALS" },
  });
  // What `completePasswordRecovery` writes after the link proves the address.
  await backend.run(async (ctx) => {
    await setNewPassword(ctx, legacyId, "admin-password-123");
    await createEmailPasswordAccount(ctx, legacyId);
  });
  expect(await signIn(backend, ADMIN_EMAIL, "admin-password-123")).toMatchObject({
    status: "complete",
    tokens: { userId: legacyId },
  });
  expect(await backend.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  expect(await signIn(backend, "nobody@example.test", "admin-password-123")).toEqual({
    status: "error",
    userError: { error: "INVALID_CREDENTIALS" },
  });
});

test("the terms step after the sign-up link records the session recording choice", async () => {
  const backend = setup();
  const userId = await backend.run((ctx) =>
    ctx.db.insert("users", {
      state: "active",
      isApproved: true,
      email: "member@example.test",
      emailVerificationTime: 1,
    }),
  );
  const viewer = backend.withIdentity({ subject: userId });
  expect(await viewer.query(api.accounts.currentViewerAccess, {})).toEqual({
    kind: "terms_required",
    userId,
  });
  await viewer.mutation(api.accounts.acceptTerms, { sessionRecordingConsent: true });
  expect(await backend.run((ctx) => ctx.db.get(userId))).toMatchObject({
    termsAcceptedAt: expect.any(Number),
    sessionRecordingConsent: { enabled: true, source: "signup", lastGrant: { source: "signup" } },
  });
  expect(await viewer.query(api.accounts.currentViewerAccess, {})).toMatchObject({
    kind: "account",
    role: "role_member",
  });
});

/** Id token claims of the identity hub for a Google account, with a claim that the profile drops. */
const googleClaims = {
  iss: "https://hub.example.test",
  sub: "hub-subject-1",
  connector: "google",
  connector_account_id: "google-account-1",
  email: "Member@Example.test",
  email_verified: true,
  name: "Member",
  picture: "https://images.example.test/member.png",
};

/** The first sign-in of a hub subject, as the hub method's `completeSignIn` hands it to the core. */
async function signInWithHub(backend: ReturnType<typeof setup>, claims: Record<string, unknown>) {
  const profile = readHubProfile(claims);
  return await backend.run(async (ctx) =>
    ctx.runMutation(components.auth.public.signUp, {
      claims: { providerName: "hub", providerAccountId: profile.id, profile },
      createUserHandle: await createFunctionHandle(internal.auth.createHubUser),
      onSignInHandle: await createFunctionHandle(internal.auth.onHubSignIn),
      issuer: "https://scout-test.convex.site",
    }),
  );
}

const readUsers = (backend: ReturnType<typeof setup>) =>
  backend.run((ctx) => ctx.db.query("users").collect());

test("a hub sign-in links to the user whose verified email is the hub's verified email", async () => {
  const backend = setup();
  const userId = await backend.run((ctx) =>
    ctx.db.insert("users", {
      state: "active",
      email: "member@example.test",
      emailVerificationTime: 1,
      isApproved: true,
      termsAcceptedAt: 1,
    }),
  );
  expect(await signInWithHub(backend, googleClaims)).toMatchObject({ userId });
  expect(await readUsers(backend)).toHaveLength(1);
});

test("a hub sign-in without a verified email is rejected", async () => {
  const backend = setup();
  const unverified = { ...googleClaims, email_verified: false };
  expect(readHubProfile(unverified)).not.toHaveProperty("email");
  await expect(signInWithHub(backend, unverified)).rejects.toThrow(
    "Google did not share a verified email address.",
  );
  expect(() => readHubProfile({ ...googleClaims, connector: "github" })).toThrow(
    "The identity hub did not complete the Google sign-in.",
  );
  expect(await readUsers(backend)).toEqual([]);
});

test("a hub sign-in does not link to a user whose own email is unverified", async () => {
  const backend = setup();
  await backend.run((ctx) =>
    ctx.db.insert("users", { state: "active", email: "member@example.test", isApproved: true }),
  );
  await expect(signInWithHub(backend, googleClaims)).rejects.toThrow(
    "Sign in with email and password",
  );
  expect(await readUsers(backend)).toEqual([
    expect.not.objectContaining({ emailVerificationTime: expect.anything() }),
  ]);
});

test("a first hub sign-in without a match creates a user like a password sign-up", async () => {
  const backend = setup();
  const { userId } = await signInWithHub(backend, googleClaims);
  expect(await readUsers(backend)).toEqual([
    expect.objectContaining({
      _id: userId,
      state: "active",
      email: "member@example.test",
      emailVerificationTime: expect.any(Number),
      isApproved: true,
      name: "Member",
      image: "https://images.example.test/member.png",
    }),
  ]);
  // The first sign-in creates the credit wallet, and the terms step comes next.
  expect(await backend.run((ctx) => ctx.db.query("creditWallets").collect())).toEqual([
    expect.objectContaining({ userId }),
  ]);
  expect(
    await backend.withIdentity({ subject: userId }).query(api.accounts.currentViewerAccess, {}),
  ).toEqual({ kind: "terms_required", userId });
});
