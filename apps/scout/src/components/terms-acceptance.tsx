import { useAuthActions } from "@convex-dev/auth/react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import { TermsCheckbox } from "./terms-checkbox";
import { Button } from "./ui/button";
import { resetAnalytics } from "../lib/posthog";

export function TermsAcceptance() {
  const accept = useMutation(api.accounts.acceptTerms);
  const { signOut } = useAuthActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function run(operation: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (caught) {
      setError(
        caught instanceof ConvexError && typeof caught.data === "string"
          ? caught.data
          : caught instanceof Error
            ? caught.message
            : "Could not complete the request.",
      );
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    void run(() => accept({}));
  }

  return (
    <main className="route-page max-w-lg">
      <h1 className="route-heading">Review our terms</h1>
      <p className="mt-3 text-muted-foreground">
        Please review and accept the Terms and conditions to continue using your TrailScout account.
      </p>
      <form className="mt-6 space-y-5" onSubmit={submit}>
        <TermsCheckbox />
        <Button type="submit" disabled={pending}>
          {pending ? "Please wait…" : "Accept and continue"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      <div className="mt-6 flex items-center gap-5 text-sm">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            resetAnalytics();
            void run(signOut);
          }}
        >
          Sign out
        </Button>
        <Link to="/account-deletion" className="underline">
          Close account
        </Link>
      </div>
    </main>
  );
}
