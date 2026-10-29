import { setupEmailPassword } from "@convex-dev/auth/methods/email-password/server";
import { setupConvexAuth } from "@convex-dev/auth/server";
import { createFunctionHandle } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { normalizeAuthEmail } from "./authEmail";
import { readDevSeedPasswordAccountConfig } from "./devAuthConfig";
import { EMAIL_FROM_HEADER } from "./email";
import { publicMutation } from "./functions";

/** The core account name of the email-password method. Every account is keyed by the users id. */
const PROVIDER_NAME = "emailPassword";

/** The landing pages of the emailed links. Each link adds its `code` query parameter. */
const SIGN_UP_URL = `${env.SITE_URL}/verify-email`;
const RECOVERY_URL = `${env.SITE_URL}/reset-password`;

/**
Scout sends the email-password method's mail through `email.sendAuthEmail`, with its own From address
and Cloudflare credentials. The method requires the Resend options; Scout's sender reads none of
them, so `apiKey` is empty.
*/
const emailSender = {
  kind: "resend" as const,
  sendEmail: internal.email.sendAuthEmail,
  apiKey: "",
  from: EMAIL_FROM_HEADER,
};

const core = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = core;

// Scout signs up and signs in with its own functions below. The method keeps the link that
// completes a sign-up and the password recovery. Scout exports no email change, so nothing links to
// `urls.changeEmail`.
// The annotation gives the exports their type without the call, whose arguments read the type of
// `internal`, which contains this module.
const emailPassword: ReturnType<
  ReturnType<typeof setupEmailPassword<"users">>["attachUserCallbacks"]
> = setupEmailPassword(core, {
  component: components.authEmail,
  passwordComponent: components.authPassword,
  emailSender,
  urls: { signUp: SIGN_UP_URL, changeEmail: SIGN_UP_URL, recovery: RECOVERY_URL },
}).attachUserCallbacks({
  createUser: internal.auth.createUser,
  onSignIn: internal.auth.onSignIn,
});
export const {
  completeSignUp,
  startPasswordRecovery,
  checkPasswordRecovery,
  completePasswordRecovery,
} = emailPassword;

const emailPasswordProvider = v.object({
  name: v.literal(PROVIDER_NAME),
  accountId: v.string(),
  profile: v.object({}),
});

/**
The core calls this when Scout creates an email-password account: `signUpWithEmailPassword` and the
seeded development account have already chosen the users row, and the account id is its id.
*/
export const createUser = internalMutation({
  args: { provider: emailPasswordProvider },
  returns: v.id("users"),
  handler: (ctx, { provider }) => {
    const userId = ctx.db.normalizeId("users", provider.accountId);
    if (userId === null) throw new Error("An email-password account id must be a users id.");
    return userId;
  },
});

/**
Runs on every sign-in: Scout's `signInWithEmailPassword`, the sign-up link, and a password recovery.
A deleting or deleted user cannot sign in. The first sign-in after a sign-up link writes the address
that the link verified to the users row.
*/
export const onSignIn = internalMutation({
  args: { provider: emailPasswordProvider, userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.state === "deleting" || user.state === "deleted")
      throw new ConvexError("This account is being deleted or has been deleted.");
    const verified = await ctx.runQuery(components.authEmail.verifiedEmails.getPrimaryEmail, {
      userId,
    });
    if (verified !== null) {
      const email = normalizeAuthEmail(verified);
      if (user.email === undefined) {
        if ((await readUserByEmail(ctx, email)) !== null)
          throw new Error("Another account already has this email address.");
        await ctx.db.patch(userId, { email, emailVerificationTime: Date.now() });
      } else if (user.email !== email) {
        throw new Error("The verified email address differs from the account email.");
      } else if (user.emailVerificationTime === undefined) {
        await ctx.db.patch(userId, { emailVerificationTime: Date.now() });
      }
    }
    await ctx.runMutation(internal.credits.grantOnSignIn, { userId });
    return null;
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

/** Sets a new password, or rejects it with a message that the sign-up form shows. */
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

const rateLimited = v.object({ error: v.literal("RATE_LIMITED"), retryAfterMs: v.number() });

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

const signInResult = v.union(
  v.object({
    status: v.literal("complete"),
    tokens: v.object({
      accessToken: v.string(),
      accessTokenExpiresAt: v.number(),
      refreshToken: v.string(),
      refreshTokenExpiresAt: v.number(),
      userId: v.string(),
    }),
  }),
  v.object({
    status: v.literal("error"),
    userError: v.union(v.object({ error: v.literal("INVALID_CREDENTIALS") }), rateLimited),
  }),
);

/**
Starts a sign-up: it sets the password and emails a link that signs the user in for the first time
through `completeSignUp`, in the same browser. An address that a link has verified already belongs to
an account (`EMAIL_TAKEN`).

An address that no row holds gets a new users row; repeated sign-ups make separate rows, and the
first link opened wins. A row that already holds the address, an account from Convex Auth 0.0.x
whose password did not carry over, is the account that the link signs in to, so the account keeps
its data. While that link waits, a sign-up for the address must use the same password, or it gets
`EMAIL_TAKEN`: otherwise a second sign-up could replace the password that the first link activates.
The comparison returns instead of throwing, so the password component's limit counts the attempt.
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

    const owner = await readUserByEmail(ctx, email);
    let userId: Id<"users">;
    if (owner === null) {
      userId = await ctx.db.insert("users", { state: "active", isApproved: true });
      await setNewPassword(ctx, userId, args.password);
      await createEmailPasswordAccount(ctx, userId);
    } else {
      if (owner.state === "deleting")
        throw new ConvexError("This account is being deleted. Try again after the deletion.");
      userId = owner._id;
      if (await hasEmailPasswordAccount(ctx, userId)) {
        const verified = await ctx.runMutation(components.authPassword.public.verifyPassword, {
          userId,
          password: args.password,
        });
        if (!verified.success) {
          const { userError } = verified;
          return {
            success: false as const,
            userError: userError.error === "RATE_LIMITED" ? userError : { error: "EMAIL_TAKEN" },
          };
        }
      } else {
        await setNewPassword(ctx, userId, args.password);
        await createEmailPasswordAccount(ctx, userId);
      }
    }

    const start = await ctx.runMutation(components.authEmail.challenge.signUp.start, {
      email,
      userId,
      url: SIGN_UP_URL,
      emailSender: {
        kind: emailSender.kind,
        sendEmailHandle: await createFunctionHandle(emailSender.sendEmail),
        from: emailSender.from,
        apiKey: emailSender.apiKey,
        initialBackoffMs: 0,
        retryAttempts: 0,
      },
    });
    // `check` passed above in this transaction, so `start` has no user error to return.
    if (!start.success) throw new Error(`The sign-up link did not start: ${start.userError.error}`);
    return { success: true as const, browserSecret: start.browserSecret };
  },
});

/** Whether the address of a users row may sign in with a password. */
async function emailIsVerified(ctx: MutationCtx, user: Doc<"users">, email: string) {
  const verified = await ctx.runQuery(components.authEmail.verifiedEmails.getPrimaryEmail, {
    userId: user._id,
  });
  if (verified !== null) return normalizeAuthEmail(verified) === email;
  // The seeded development account has no sign-up link: devAuth.ts creates its account.
  const seed = readDevSeedPasswordAccountConfig();
  return seed.kind === "enabled" && seed.email === email;
}

/**
Signs in with an email address and a password. Scout finds the account through `users.email`
rather than the method's own lookup, whose limit counts the client IP: behind the `/auth/signin`
route every call comes from the server, so all visitors would share one limit. The password
component limits the attempts on each account. An unknown address and a wrong password give the
same error.
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
    const email = normalizeAuthEmail(args.email);
    const user = await readUserByEmail(ctx, email);
    if (user === null || !(await emailIsVerified(ctx, user, email))) return invalid;
    const verified = await ctx.runMutation(components.authPassword.public.verifyPassword, {
      userId: user._id,
      password: args.password,
    });
    if (!verified.success)
      return verified.userError.error === "RATE_LIMITED"
        ? { status: "error" as const, userError: verified.userError }
        : invalid;
    const tokens = await ctx.runMutation(components.auth.public.signIn, {
      claims: { providerName: PROVIDER_NAME, providerAccountId: user._id, profile: {} },
      onSignInHandle: await createFunctionHandle(internal.auth.onSignIn),
      issuer: env.CONVEX_SITE_URL,
    });
    return { status: "complete" as const, tokens };
  },
});
