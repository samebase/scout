import { useAuthActions } from "@convex-dev/auth/react";
import { type FormEvent, useState } from "react";
import { ConvexError } from "convex/values";
import { AUTH_EMAIL_COOLDOWN } from "../../shared/auth";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";

const PASSWORD_MIN_LENGTH = 8;
const CODE_LENGTH = 8;

type CredentialsFlow = "signIn" | "signUp";
type AuthState =
  | { kind: "credentials"; flow: CredentialsFlow; email: string }
  | { kind: "verifyEmail"; email: string }
  | { kind: "requestReset"; email: string }
  | { kind: "resetPassword"; email: string };

type AuthAction = CredentialsFlow | "verifyEmail" | "requestReset" | "resetPassword";

export function AuthPanel() {
  const { signIn } = useAuthActions();
  const [state, setState] = useState<AuthState>({
    kind: "credentials",
    flow: "signIn",
    email: "",
  });
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");

  const run = async (action: AuthAction, operation: () => Promise<void>) => {
    setError("");
    setIsPending(true);
    try {
      await operation();
    } catch (caught: unknown) {
      setError(authErrorMessage(caught, action));
    } finally {
      setIsPending(false);
    }
  };

  const submitCredentials = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "credentials") {
      return;
    }
    const formData = new FormData(event.currentTarget);
    const email = formValue(formData, "email").trim().toLowerCase();
    formData.set("email", email);
    formData.set("flow", state.flow);

    void run(state.flow, async () => {
      const result = await signIn("password", formData);
      if (!result.signingIn) {
        setState({ kind: "verifyEmail", email });
      }
    });
  };

  const submitVerification = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "verifyEmail") {
      return;
    }
    const formData = new FormData(event.currentTarget);
    formData.set("email", state.email);
    formData.set("flow", "email-verification");
    void run("verifyEmail", async () => {
      await signIn("password", formData);
    });
  };

  const submitResetRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = formValue(formData, "email").trim().toLowerCase();
    formData.set("email", email);
    formData.set("flow", "reset");
    void run("requestReset", async () => {
      await signIn("password", formData);
      setState({ kind: "resetPassword", email });
    });
  };

  const submitPasswordReset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "resetPassword") {
      return;
    }
    const formData = new FormData(event.currentTarget);
    const newPassword = formValue(formData, "newPassword");
    if (newPassword !== formValue(formData, "confirmPassword")) {
      setError("Passwords do not match.");
      return;
    }
    formData.set("email", state.email);
    formData.set("flow", "reset-verification");
    void run("resetPassword", async () => {
      await signIn("password", formData);
    });
  };

  const showSignIn = (email = state.email) => {
    setError("");
    setState({ kind: "credentials", flow: "signIn", email });
  };

  return (
    <section className="surface-panel flex flex-col gap-6 p-5 sm:p-7" aria-label="Account access">
      <AuthHeading state={state} />

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
              minLength={PASSWORD_MIN_LENGTH}
              required
            />
          </label>
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

      {state.kind === "verifyEmail" ? (
        <form className="flex flex-col gap-4" onSubmit={submitVerification}>
          <CodeField id="verification-code" />
          <Button type="submit" disabled={isPending}>
            {isPending ? "Verifying" : "Verify email"}
          </Button>
          <Button type="button" variant="link" disabled={isPending} onClick={() => showSignIn()}>
            Back to sign in
          </Button>
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
            {isPending ? "Sending" : "Send reset code"}
          </Button>
          <Button type="button" variant="link" disabled={isPending} onClick={() => showSignIn()}>
            Back to sign in
          </Button>
        </form>
      ) : null}

      {state.kind === "resetPassword" ? (
        <form className="flex flex-col gap-4" onSubmit={submitPasswordReset}>
          <CodeField id="reset-code" />
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="new-password">
            New password
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="confirm-password">
            Confirm password
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
            />
          </label>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Updating" : "Update password"}
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={isPending}
            onClick={() => setState({ kind: "requestReset", email: state.email })}
          >
            Request a new code
          </Button>
        </form>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
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
            ? "Sign in to your Scout account."
            : "Create an account, then wait for admin approval."}
        </p>
      </div>
    );
  }
  if (state.kind === "verifyEmail") {
    return (
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-[-0.035em]">Check your email</h2>
        <p className="text-muted-foreground text-sm">Enter the code sent to {state.email}.</p>
      </div>
    );
  }
  if (state.kind === "requestReset") {
    return <h2 className="text-2xl font-semibold tracking-[-0.035em]">Reset password</h2>;
  }
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-2xl font-semibold tracking-[-0.035em]">Choose a new password</h2>
      <p className="text-muted-foreground text-sm">Enter the code sent to {state.email}.</p>
    </div>
  );
}

function CodeField({ id }: { id: string }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium" htmlFor={id}>
      Verification code
      <Input
        id={id}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`[0-9]{${CODE_LENGTH}}`}
        minLength={CODE_LENGTH}
        maxLength={CODE_LENGTH}
        className="text-center text-lg tracking-[0.35em]"
        required
        autoFocus
      />
    </label>
  );
}

function pendingLabel(flow: CredentialsFlow, isPending: boolean) {
  if (!isPending) {
    return flow === "signIn" ? "Sign in" : "Create account";
  }
  return flow === "signIn" ? "Signing in" : "Creating account";
}

function authErrorMessage(error: unknown, action: AuthAction) {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof ConvexError && error.data === AUTH_EMAIL_COOLDOWN) {
    return "Wait a minute before requesting another code.";
  }
  if (action === "signIn" && /(invalid credentials|invalidsecret)/i.test(message)) {
    return "Email or password is incorrect.";
  }
  if (action === "signUp" && /invalid password/i.test(message)) {
    return "Password must be at least 8 characters.";
  }
  if (action === "verifyEmail" || action === "resetPassword") {
    return "The code is invalid or expired.";
  }
  if (action === "requestReset") {
    return "Could not send a reset code. Check the email and try again.";
  }
  return action === "signIn"
    ? "Could not sign in. Check your details and try again."
    : "Could not create the account. Try signing in if it already exists.";
}

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
