import { DEFAULT_MIN_PASSWORD_LENGTH } from "@convex-dev/auth/methods/email-password";
import { useCompletePasswordRecovery } from "@convex-dev/auth/methods/email-password/react";
import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { authErrorMessage } from "#components/auth-panel";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";

// The landing page of the password recovery link: it sets the new password and signs in.
export const Route = createFileRoute("/reset-password")({
  ssr: false,
  staticData: { access: "access_public" },
  validateSearch: (search) => z.object({ code: z.string() }).parse(search),
  head: () => ({ meta: [{ title: "Reset password | TrailScout" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { code } = Route.useSearch();
  const state = useCompletePasswordRecovery(api.auth, { emailCode: code });
  const [error, setError] = useState("");

  if (state.status === "complete") return <Navigate to="/" replace />;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.status !== "ready") return;
    const form = new FormData(event.currentTarget);
    const newPassword = form.get("newPassword");
    if (typeof newPassword !== "string" || newPassword !== form.get("confirmPassword")) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    void state.completePasswordRecovery({ newPassword }).then((result) => {
      if (result.status === "error") setError(authErrorMessage(result.userError));
    });
  };

  return (
    <main className="route-page max-w-md" aria-busy={state.status === "loading"}>
      <h1 className="route-heading">Choose a new password</h1>
      {state.status === "ready" ? (
        <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="new-password">
            New password
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={DEFAULT_MIN_PASSWORD_LENGTH}
              required
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="confirm-password">
            Confirm password
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={DEFAULT_MIN_PASSWORD_LENGTH}
              required
            />
          </label>
          <Button type="submit" disabled={state.pending}>
            {state.pending ? "Updating" : "Update password"}
          </Button>
        </form>
      ) : null}
      {state.status === "error" ? (
        <>
          <p role="alert" className="mt-3 text-destructive">
            {authErrorMessage(state.userError)}
          </p>
          <Link to="/" className="mt-6 inline-block text-sm underline">
            Back to TrailScout
          </Link>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </main>
  );
}
