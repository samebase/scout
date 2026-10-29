import { DEFAULT_MIN_PASSWORD_LENGTH } from "@convex-dev/auth/methods/email-password";
import {
  type CompletePasswordRecoveryResult,
  type CompletePasswordRecoveryState,
  type CompleteSignUpState,
  type SignInResult,
  type SignUpResult,
  type StartPasswordRecoveryResult,
  useSignInWithEmailPassword,
  useSignUpWithEmailPassword,
  useStartPasswordRecovery,
} from "@convex-dev/auth/methods/email-password/react";
import {
  type OauthFlowError,
  type OauthStartResult,
  useOauth,
  useOauthSignIn,
} from "@convex-dev/auth/methods/oauth/react";
import { type FormEvent, useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { LegalLinks } from "./legal-links";

type CredentialsFlow = "signIn" | "signUp";
type AuthState =
  | { kind: "credentials"; flow: CredentialsFlow; email: string }
  | { kind: "requestReset"; email: string }
  | { kind: "checkEmail"; email: string };

type UserError =
  | Extract<SignInResult, { status: "error" }>["userError"]
  | Extract<SignUpResult, { success: false }>["userError"]
  | Extract<StartPasswordRecoveryResult, { success: false }>["userError"]
  | Extract<OauthStartResult, { status: "error" }>["userError"];

/**
The errors of the email-password method and of Google sign-in that the sign-in panel and the link
pages show. A Google sign-in that fails after the identity hub returns reports its error as the OAuth
method's `flowError`.
*/
export type AuthUserError =
  | UserError
  | OauthFlowError
  | Extract<CompleteSignUpState, { status: "error" }>["userError"]
  | Extract<CompletePasswordRecoveryState, { status: "error" }>["userError"]
  | Extract<CompletePasswordRecoveryResult, { status: "error" }>["userError"];

export function AuthPanel() {
  const { signIn } = useSignInWithEmailPassword(api.auth);
  const { signUp } = useSignUpWithEmailPassword(api.auth);
  const { startPasswordRecovery } = useStartPasswordRecovery(api.auth);
  const { signIn: signInWithGoogle } = useOauthSignIn({
    providerName: "hub",
    startSignIn: api.auth.startSignInWithHub,
    completeSignIn: api.auth.completeSignInWithHub,
  });
  const { flowError } = useOauth();
  const [state, setState] = useState<AuthState>({
    kind: "credentials",
    flow: "signIn",
    email: "",
  });
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");

  const run = async (operation: () => Promise<UserError | null>) => {
    setError("");
    setIsPending(true);
    const userError = await operation();
    setIsPending(false);
    if (userError) setError(authErrorMessage(userError));
  };

  const submitCredentials = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "credentials") return;
    const email = state.email.trim();
    void run(async () => {
      if (state.flow === "signIn") {
        const result = await signIn({ email, password });
        return result.status === "error" ? result.userError : null;
      }
      const result = await signUp({ email, password });
      if (!result.success) return result.userError;
      setState({ kind: "checkEmail", email });
      return null;
    });
  };

  const submitResetRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "requestReset") return;
    void run(async () => {
      const result = await startPasswordRecovery({ email: state.email.trim() });
      if (!result.success) return result.userError;
      setState({ kind: "checkEmail", email: result.sentTo });
      return null;
    });
  };

  const showSignIn = (email = state.email) => {
    setError("");
    setState({ kind: "credentials", flow: "signIn", email });
  };

  return (
    <section
      data-posthog-block
      className="surface-panel flex flex-col gap-6 p-5 sm:p-7"
      aria-label="Account access"
    >
      <AuthHeading state={state} />

      {state.kind === "credentials" ? (
        // The identity hub returns to this page, where the session provider redeems the sign-in.
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          disabled={isPending}
          onClick={() =>
            void run(async () => {
              const result = await signInWithGoogle();
              return result.status === "error" ? result.userError : null;
            })
          }
        >
          Continue with Google
        </Button>
      ) : null}

      {state.kind === "credentials" ? (
        <form className="flex flex-col gap-4" onSubmit={submitCredentials}>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="auth-email">
            Email
            <Input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              value={state.email}
              onChange={(event) => setState({ ...state, email: event.target.value })}
              required
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="auth-password">
            Password
            <Input
              id="auth-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={state.flow === "signUp" ? "new-password" : "current-password"}
              minLength={state.flow === "signUp" ? DEFAULT_MIN_PASSWORD_LENGTH : undefined}
              required
            />
          </label>
          <LegalLinks />
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={isPending}>
            {pendingLabel(state.flow, isPending)}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              disabled={isPending}
              onClick={() =>
                setState({
                  kind: "credentials",
                  flow: state.flow === "signIn" ? "signUp" : "signIn",
                  email: state.email,
                })
              }
            >
              {state.flow === "signIn" ? "Create account" : "Sign in instead"}
            </Button>
            {state.flow === "signIn" ? (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                disabled={isPending}
                onClick={() => setState({ kind: "requestReset", email: state.email })}
              >
                Forgot password?
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {state.kind === "requestReset" ? (
        <form className="flex flex-col gap-4" onSubmit={submitResetRequest}>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="reset-email">
            Email
            <Input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              value={state.email}
              onChange={(event) => setState({ kind: "requestReset", email: event.target.value })}
              required
              autoFocus
            />
          </label>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Sending" : "Send reset link"}
          </Button>
          <Button type="button" variant="link" disabled={isPending} onClick={() => showSignIn()}>
            Back to sign in
          </Button>
        </form>
      ) : null}

      {state.kind === "checkEmail" ? (
        <Button type="button" variant="link" onClick={() => showSignIn()}>
          Back to sign in
        </Button>
      ) : null}

      {error || flowError ? (
        <p className="text-destructive text-sm" role="alert">
          {error || (flowError && authErrorMessage(flowError))}
        </p>
      ) : null}
      {state.kind !== "credentials" && <LegalLinks />}
    </section>
  );
}

function AuthHeading({ state }: { state: AuthState }) {
  if (state.kind === "credentials") {
    return (
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.035em]">
          {state.flow === "signIn" ? "Welcome back" : "Create account"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {state.flow === "signIn"
            ? "Sign in to your TrailScout account."
            : "Create an account and verify your email to get started."}
        </p>
      </div>
    );
  }
  if (state.kind === "checkEmail") {
    return (
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-[-0.035em]">Check your email</h2>
        <p className="text-muted-foreground text-sm">
          Open the link sent to {state.email} in this browser.
        </p>
      </div>
    );
  }
  return <h2 className="text-2xl font-semibold tracking-[-0.035em]">Reset password</h2>;
}

function pendingLabel(flow: CredentialsFlow, isPending: boolean) {
  if (!isPending) {
    return flow === "signIn" ? "Sign in" : "Create account";
  }
  return flow === "signIn" ? "Signing in" : "Creating account";
}

export function authErrorMessage(userError: AuthUserError) {
  switch (userError.error) {
    case "INVALID_CREDENTIALS":
    case "USER_NOT_FOUND":
      return "Email or password is incorrect.";
    case "RATE_LIMITED":
      return `Too many attempts. Try again in ${Math.ceil(userError.retryAfterMs / 1000)} seconds.`;
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    case "EMAIL_TAKEN":
      return "An account already uses this email. Sign in, or reset its password.";
    case "EMAIL_NOT_FOUND":
      return "No account uses this email.";
    case "PASSWORD_TOO_SHORT":
      return `Use at least ${userError.minimumLength} characters.`;
    case "PASSWORD_TOO_LONG":
      return `Use at most ${userError.maximumLength} characters.`;
    case "PASSWORD_HAS_SURROUNDING_WHITESPACE":
      return "The password cannot start or end with a space.";
    case "PASSWORD_TOO_COMMON":
      return "This password is too common. Choose another one.";
    case "INVALID_CHALLENGE":
      return "This link has expired or was already used. Start again from the sign-in page.";
    case "INCORRECT_CODE":
      return "This is not the newest link. Open the newest email.";
    case "MISSING_SECRET":
      return "Open the link in the browser where you started.";
    case "ACCESS_DENIED":
      return "Google sign-in was canceled.";
    case "EXPIRED":
      return "The Google sign-in expired. Try again.";
    case "INVALID_FLOW":
      return "Start the Google sign-in again in this browser.";
    case "REJECTED":
      return typeof userError.data === "string"
        ? userError.data
        : "Something went wrong. Try again.";
    case "OTHER_ERROR":
      return userError.cause instanceof ConvexError && typeof userError.cause.data === "string"
        ? userError.cause.data
        : "Something went wrong. Try again.";
    default:
      userError satisfies never;
      return "Something went wrong. Try again.";
  }
}
