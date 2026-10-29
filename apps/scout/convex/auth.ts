import { setupOauth } from "@convex-dev/auth/methods/oauth/server";
import { setupConvexAuth } from "@convex-dev/auth/server";
import { validate } from "convex-helpers/validators";
import { createFunctionHandle } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { omitNullish } from "../shared/omitNullish";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { normalizeAuthEmail } from "./authEmail";
import { EMAIL_FROM_HEADER } from "./email";
import { publicMutation, publicQuery } from "./functions";

// Scout's email and password sign-in, on the components of Convex Auth's email-password method:
// the email component sends and checks the links, the password component keeps the hashes, and the
// core keeps the sessions. The method's React hooks call these functions, whose names, arguments,
// and results are the method's. `users.email` decides which account owns an address, so an account
// from Convex Auth 0.0.x keeps its row and data: it sets a password through the recovery link.
// Google sign-in runs through the team's identity hub with Convex Auth's OAuth method, at the end
// of this file.

const core = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = core;

/** The core account name. Every account is keyed by its users id. */
const PROVIDER_NAME = "emailPassword";
const RECOVERY_PURPOSE = "scout/passwordRecovery";
/** OWASP ASVS v5 6.5.5: a password reset link works for at most 10 minutes. */
const RECOVERY_TTL_MS = 10 * 60 * 1000;

/**
The sender of the links: `email.sendAuthEmail` sends from Scout's address with Scout's Cloudflare
credentials, so the options that the email component passes on for Resend are not read.
*/
async function emailSender() {
  return {
    kind: "resend" as const,
    sendEmailHandle: await createFunctionHandle(internal.email.sendAuthEmail),
    from: EMAIL_FROM_HEADER,
    apiKey: "",
    initialBackoffMs: 0,
    retryAttempts: 0,
  };
}

/**
The core calls this when Scout creates an email-password account: the sign-up and the seeded
development account have already chosen the users row, and the account id is its id.
*/
export const createUser = internalMutation({
  args: {
    provider: v.object({
      name: v.literal(PROVIDER_NAME),
      accountId: v.string(),
      profile: v.object({}),
    }),
  },
  returns: v.id("users"),
  handler: (ctx, { provider }) => {
    const userId = ctx.db.normalizeId("users", provider.accountId);
    if (userId === null) throw new Error("An email-password account id must be a users id.");
    return userId;
  },
});

/**
The users row that holds a normalized email. Two rows with one email, or a deleted row with an
email, break an invariant.
*/
export async function readUserByEmail(ctx: Pick<QueryCtx, "db">, email: string) {
  const users = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .take(2);
  if (users.length > 1) throw new Error("Two accounts have the same email address.");
  const user = users[0] ?? null;
  if (user?.state === "deleted") throw new Error("A deleted account has an email address.");
  return user;
}

/** Sets a new password, or rejects it with a message that the form shows. */
export async function setNewPassword(ctx: MutationCtx, userId: Id<"users">, password: string) {
  const result = await ctx.runMutation(components.authPassword.public.setPassword, {
    userId,
    password,
  });
  if (result.success) return;
  const { userError } = result;
  switch (userError.error) {
    case "PASSWORD_TOO_SHORT":
      throw new ConvexError(`Use at least ${userError.minimumLength} characters.`);
    case "PASSWORD_TOO_LONG":
      throw new ConvexError(`Use at most ${userError.maximumLength} characters.`);
    case "PASSWORD_HAS_SURROUNDING_WHITESPACE":
      throw new ConvexError("The password cannot start or end with a space.");
    case "PASSWORD_TOO_COMMON":
      throw new ConvexError("This password is too common. Choose another one.");
    default:
      userError satisfies never;
      throw new ConvexError("This password cannot be used.");
  }
}

/** Creates the core account of a users row, keyed by its id, without a session. */
export async function createEmailPasswordAccount(ctx: MutationCtx, userId: Id<"users">) {
  await ctx.runMutation(components.auth.public.signUpWithoutSession, {
    claims: { providerName: PROVIDER_NAME, providerAccountId: userId, profile: {} },
    createUserHandle: await createFunctionHandle(internal.auth.createUser),
  });
}

export async function hasEmailPasswordAccount(ctx: MutationCtx, userId: Id<"users">) {
  const accountUserId = await ctx.runQuery(components.auth.public.getUserIdByAccount, {
    provider: PROVIDER_NAME,
    providerAccountId: userId,
  });
  return accountUserId !== null;
}

/** What every sign-in does before its session: it admits an active user and grants the credits. */
async function admitSignIn(ctx: MutationCtx, user: Doc<"users">) {
  if (user.state === "deleting" || user.state === "deleted")
    throw new ConvexError("This account is being deleted or has been deleted.");
  await ctx.runMutation(internal.credits.grantOnSignIn, { userId: user._id });
}

/** Mints a session for an active user and grants the sign-in credits. */
async function startSession(ctx: MutationCtx, user: Doc<"users">) {
  await admitSignIn(ctx, user);
  return await ctx.runMutation(components.auth.public.signIn, {
    claims: { providerName: PROVIDER_NAME, providerAccountId: user._id, profile: {} },
    issuer: env.CONVEX_SITE_URL,
  });
}

const tokens = v.object({
  accessToken: v.string(),
  accessTokenExpiresAt: v.number(),
  refreshToken: v.string(),
  refreshTokenExpiresAt: v.number(),
  userId: v.string(),
});
const rateLimited = v.object({ error: v.literal("RATE_LIMITED"), retryAfterMs: v.number() });
const linkError = v.union(
  v.object({ error: v.literal("INVALID_CHALLENGE") }),
  v.object({ error: v.literal("INCORRECT_CODE") }),
);

const signUpResult = v.union(
  v.object({ success: v.literal(true), browserSecret: v.string() }),
  v.object({
    success: v.literal(false),
    userError: v.union(
      v.object({ error: v.literal("INVALID_EMAIL") }),
      rateLimited,
      v.object({ error: v.literal("EMAIL_TAKEN") }),
    ),
  }),
);

/**
Starts a sign-up: a new users row with the password, and an emailed link that `completeSignUp`
signs in with for the first time, in the same browser. Repeated sign-ups make separate rows, and the
first link opened wins. An address that a users row holds gets `EMAIL_TAKEN`, so an account from
before keeps its row and resets its password instead; no password reaches an existing row before
its owner opens a link.
*/
export const signUpWithEmailPassword = publicMutation({
  access: "access_public",
  args: { email: v.string(), password: v.string() },
  returns: signUpResult,
  handler: async (ctx, args): Promise<Infer<typeof signUpResult>> => {
    const email = normalizeAuthEmail(args.email);
    const emailError = await ctx.runMutation(components.authEmail.challenge.signUp.check, {
      email,
    });
    if (emailError !== null) return { success: false as const, userError: emailError };
    if ((await readUserByEmail(ctx, email)) !== null) {
      // The answer tells that the address has an account: count it, as the component counts its
      // own EMAIL_TAKEN.
      const lookup = await ctx.runMutation(components.authEmail.verifiedEmails.lookupEmail, {
        email,
      });
      return {
        success: false as const,
        userError:
          !lookup.success && lookup.userError.error === "RATE_LIMITED"
            ? lookup.userError
            : { error: "EMAIL_TAKEN" as const },
      };
    }

    const userId = await ctx.db.insert("users", { state: "active", isApproved: true });
    await setNewPassword(ctx, userId, args.password);
    await createEmailPasswordAccount(ctx, userId);
    const start = await ctx.runMutation(components.authEmail.challenge.signUp.start, {
      email,
      userId,
      url: `${env.SITE_URL}/verify-email`,
      emailSender: await emailSender(),
    });
    // `check` passed above in this transaction, so `start` has no user error to return.
    if (!start.success) throw new Error(`The sign-up link did not start: ${start.userError.error}`);
    return { success: true as const, browserSecret: start.browserSecret };
  },
});

const completeSignUpResult = v.union(
  v.object({ status: v.literal("complete"), tokens }),
  v.object({
    status: v.literal("error"),
    userError: v.union(linkError, v.object({ error: v.literal("EMAIL_TAKEN") })),
  }),
);

/** Opens the sign-up link: it writes the verified address to the new row and signs it in. */
export const completeSignUp = publicMutation({
  access: "access_public",
  args: { emailCode: v.string(), browserSecret: v.string() },
  returns: completeSignUpResult,
  handler: async (ctx, args): Promise<Infer<typeof completeSignUpResult>> => {
    const complete = await ctx.runMutation(components.authEmail.challenge.signUp.complete, {
      emailCode: args.emailCode,
      browserSecret: args.browserSecret,
    });
    if (!complete.success) return { status: "error" as const, userError: complete.userError };
    const userId = ctx.db.normalizeId("users", complete.userId);
    const user = userId && (await ctx.db.get(userId));
    if (!user || user.state === "deleted" || user.email !== undefined)
      throw new Error("A sign-up link must belong to a new users row.");
    const email = normalizeAuthEmail(complete.email);
    if ((await readUserByEmail(ctx, email)) !== null)
      throw new Error("Another account already has this email address.");
    await ctx.db.patch(user._id, { email, emailVerificationTime: Date.now() });
    return { status: "complete" as const, tokens: await startSession(ctx, user) };
  },
});

const signInResult = v.union(
  v.object({ status: v.literal("complete"), tokens }),
  v.object({
    status: v.literal("error"),
    userError: v.union(v.object({ error: v.literal("INVALID_CREDENTIALS") }), rateLimited),
  }),
);

/**
Signs in with an email address and a password. The address must belong to a users row with an
email-password account, which a sign-up link, a recovery link, or the development seed creates.
The method's own sign-in limits address lookups per client IP, and the `/auth/signin` route calls
Convex from the server without the client's address, so all visitors would share one limit; the
password component limits the attempts on each account instead. An unknown address and a wrong
password give the same error.
*/
export const signInWithEmailPassword = publicMutation({
  access: "access_public",
  args: { email: v.string(), password: v.string() },
  returns: signInResult,
  handler: async (ctx, args): Promise<Infer<typeof signInResult>> => {
    const invalid = {
      status: "error" as const,
      userError: { error: "INVALID_CREDENTIALS" as const },
    };
    const user = await readUserByEmail(ctx, normalizeAuthEmail(args.email));
    if (user === null || !(await hasEmailPasswordAccount(ctx, user._id))) return invalid;
    const verified = await ctx.runMutation(components.authPassword.public.verifyPassword, {
      userId: user._id,
      password: args.password,
    });
    if (!verified.success)
      return verified.userError.error === "RATE_LIMITED"
        ? { status: "error" as const, userError: verified.userError }
        : invalid;
    return { status: "complete" as const, tokens: await startSession(ctx, user) };
  },
});

const startPasswordRecoveryResult = v.union(
  v.object({ success: v.literal(true), browserSecret: v.string(), sentTo: v.string() }),
  v.object({
    success: v.literal(false),
    userError: v.union(
      v.object({ error: v.literal("INVALID_EMAIL") }),
      rateLimited,
      v.object({ error: v.literal("EMAIL_NOT_FOUND") }),
    ),
  }),
);

/**
Emails a recovery link, valid for 10 minutes in the same browser, to the address of a users row.
This is also how an account from Convex Auth 0.0.x, whose password did not carry over, sets one.
*/
export const startPasswordRecovery = publicMutation({
  access: "access_public",
  args: { email: v.string() },
  returns: startPasswordRecoveryResult,
  handler: async (ctx, args): Promise<Infer<typeof startPasswordRecoveryResult>> => {
    const email = normalizeAuthEmail(args.email);
    // The answer tells whether the address has an account: count it against the component's
    // per-IP lookup limit, as the method's own recovery does.
    const lookup = await ctx.runMutation(components.authEmail.verifiedEmails.lookupEmail, {
      email,
    });
    if (!lookup.success && lookup.userError.error === "RATE_LIMITED")
      return { success: false as const, userError: lookup.userError };
    const user = await readUserByEmail(ctx, email);
    if (user === null || user.state === "deleting")
      return { success: false as const, userError: { error: "EMAIL_NOT_FOUND" as const } };
    const start = await ctx.runMutation(components.authEmail.challenge.custom.start, {
      email,
      purpose: RECOVERY_PURPOSE,
      // The account is found again from the address when the link is opened.
      expectedUserId: null,
      url: `${env.SITE_URL}/reset-password`,
      emailSender: await emailSender(),
      ttlMs: RECOVERY_TTL_MS,
      subject: "Reset your TrailScout password",
      intro: "Open this link to choose a new TrailScout password:",
    });
    if (!start.success) return { success: false as const, userError: start.userError };
    return { success: true as const, browserSecret: start.browserSecret, sentTo: email };
  },
});

/** The active users row that a recovery link's address belongs to now, if any. */
async function readRecoveryUser(ctx: Pick<QueryCtx, "db">, email: string) {
  const user = await readUserByEmail(ctx, normalizeAuthEmail(email));
  return user?.state === "deleting" ? null : user;
}

const checkPasswordRecoveryResult = v.union(
  v.object({ success: v.literal(true) }),
  v.object({ success: v.literal(false), userError: linkError }),
);

/** Tells the recovery page whether `completePasswordRecovery` would accept the link. */
export const checkPasswordRecovery = publicQuery({
  access: "access_public",
  args: { emailCode: v.string(), browserSecret: v.string() },
  returns: checkPasswordRecoveryResult,
  handler: async (ctx, args): Promise<Infer<typeof checkPasswordRecoveryResult>> => {
    const peek = await ctx.runQuery(components.authEmail.challenge.custom.peek, {
      emailCode: args.emailCode,
      browserSecret: args.browserSecret,
      purpose: RECOVERY_PURPOSE,
      currentUserId: null,
    });
    if (!peek.success) {
      if (peek.userError.error === "WRONG_USER")
        throw new Error("A recovery link expects no user, so WRONG_USER cannot happen.");
      return { success: false as const, userError: peek.userError };
    }
    return (await readRecoveryUser(ctx, peek.email)) === null
      ? { success: false as const, userError: { error: "INVALID_CHALLENGE" as const } }
      : { success: true as const };
  },
});

const completePasswordRecoveryResult = v.union(
  v.object({ status: v.literal("complete"), tokens }),
  v.object({ status: v.literal("error"), userError: linkError }),
);

/**
Opens the recovery link: it sets the new password and signs in, and every other session of the
account ends. A rejected password throws, so the link stays usable. The link proves the address, so
an account from Convex Auth 0.0.x gets its email-password account here.
*/
export const completePasswordRecovery = publicMutation({
  access: "access_public",
  args: { emailCode: v.string(), browserSecret: v.string(), newPassword: v.string() },
  returns: completePasswordRecoveryResult,
  handler: async (ctx, args): Promise<Infer<typeof completePasswordRecoveryResult>> => {
    const complete = await ctx.runMutation(components.authEmail.challenge.custom.complete, {
      emailCode: args.emailCode,
      browserSecret: args.browserSecret,
      purpose: RECOVERY_PURPOSE,
      currentUserId: null,
    });
    if (!complete.success) {
      if (complete.userError.error === "WRONG_USER")
        throw new Error("A recovery link expects no user, so WRONG_USER cannot happen.");
      return { status: "error" as const, userError: complete.userError };
    }
    const user = await readRecoveryUser(ctx, complete.email);
    if (user === null)
      return { status: "error" as const, userError: { error: "INVALID_CHALLENGE" as const } };
    await setNewPassword(ctx, user._id, args.newPassword);
    // The core deletes sessions only together with the accounts, so this ends the Google sessions
    // too and removes the hub account. The email-password account is created again below; the
    // next Google sign-in links the hub account again by the verified email.
    await ctx.runMutation(components.auth.public.deleteUser, { userId: user._id });
    await createEmailPasswordAccount(ctx, user._id);
    if (user.emailVerificationTime === undefined)
      await ctx.db.patch(user._id, { emailVerificationTime: Date.now() });
    return { status: "complete" as const, tokens: await startSession(ctx, user) };
  },
});

/**
The id_token claims of the identity hub that a Google sign-in reads. `sub` is pairwise: stable for
TrailScout, different in every other app of the hub. A user can edit the authorize URL, so the
`connector` claim, not the URL, keeps the method to Google. Convex Auth checks the issuer, audience,
and expiry of the id_token, which it received over TLS from the hub's token endpoint, but not the
types of its claims.
*/
const hubClaims = v.object({
  sub: v.string(),
  connector: v.literal("google"),
  connector_account_id: v.string(),
  email: v.optional(v.string()),
  email_verified: v.optional(v.boolean()),
  name: v.optional(v.string()),
  picture: v.optional(v.string()),
});

/**
The profile mapping of the hub method below. It refuses claims of another shape or of another
connector with a message for the sign-in page, and keeps the email only when the hub verified it:
`createHubUser` finds an existing user by the email.
*/
export function readHubProfile(claims: unknown) {
  if (!validate(hubClaims, claims, { allowUnknownFields: true }))
    throw new ConvexError("The identity hub did not complete the Google sign-in. Try again.");
  return {
    id: claims.sub,
    connector: claims.connector,
    connector_account_id: claims.connector_account_id,
    ...omitNullish({
      name: claims.name,
      picture: claims.picture,
      email: claims.email_verified === true ? claims.email : undefined,
    }),
  };
}

/** The sign-in that the hub method hands to its user callbacks, with the profile above. */
const hubSignIn = v.object({
  name: v.literal("hub"),
  accountId: v.string(),
  profile: hubClaims.omit("sub", "email_verified").extend({ id: v.string() }),
});

/**
The core calls this the first time it sees a hub subject. The user is the one whose email is the
hub's verified email, when that row has verified its own email too, else a new user, set up like a
password sign-up: approved, with a verified email, and with the terms step still ahead. The core
keeps the subject for that user, so later sign-ins find it directly, and `onHubSignIn` runs next.
*/
export const createHubUser = internalMutation({
  args: { provider: hubSignIn },
  returns: v.id("users"),
  handler: async (ctx, { provider }) => {
    if (provider.profile.email === undefined)
      throw new ConvexError(
        "Google did not share a verified email address. Sign in with email and password instead.",
      );
    const email = normalizeAuthEmail(provider.profile.email);
    const user = await readUserByEmail(ctx, email);
    if (user !== null) {
      if (user.emailVerificationTime === undefined)
        throw new ConvexError(
          "An account with this email has not verified it yet. Sign in with email and password, or use Forgot password? to verify it.",
        );
      return user._id;
    }
    return await ctx.db.insert("users", {
      state: "active",
      email,
      emailVerificationTime: Date.now(),
      isApproved: true,
      ...omitNullish({ name: provider.profile.name, image: provider.profile.picture }),
    });
  },
});

/** The core calls this on every hub sign-in, the first one included, before it mints the session. */
export const onHubSignIn = internalMutation({
  args: { provider: hubSignIn, userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user === null) throw new Error("A hub account must belong to a users row.");
    await admitSignIn(ctx, user);
    return null;
  },
});

/**
Google sign-in through the identity hub, an OpenID Provider at HUB_ISSUER. TrailScout is a
first-party app of the hub, so the hub skips its chooser and sends the browser straight to Google.
The flow returns to the page that started it, on SITE_URL or on CONVEX_SITE_URL, which serves the
same build. The annotation gives the exports below their types without the call, which reads the
type of `internal`, which contains this module.
*/
const hub: ReturnType<typeof setupOauth> = setupOauth(
  core,
  "hub",
  {
    authorizationEndpoint: `${env.HUB_ISSUER}/authorize?connector=google`,
    tokenEndpoint: `${env.HUB_ISSUER}/token`,
    issuer: env.HUB_ISSUER,
    scopes: ["openid", "email", "profile"],
    profile: readHubProfile,
  },
  { createUser: internal.auth.createHubUser, onSignIn: internal.auth.onHubSignIn },
  {
    component: components.authHub,
    allowedRedirectOrigins: [new URL(env.SITE_URL).origin, new URL(env.CONVEX_SITE_URL).origin],
  },
);
export const startSignInWithHub = hub.startSignIn;
export const completeSignInWithHub = hub.completeSignIn;
