import { useAuthActions } from "@convex-dev/auth/react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { ACCOUNT_DELETION_CONFIRMATION } from "../../shared/accountDeletion";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { LegalLinks } from "#components/legal-links";

export const Route = createFileRoute("/account-deletion")({
  ssr: false,
  staticData: { access: "access_public" },
  head: () => ({ meta: [{ title: "Delete account | TrailScout" }] }),
  component: AccountDeletionPage,
});

function AccountDeletionPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const status = useQuery(api.accountDeletion.status, isAuthenticated ? {} : "skip");
  const request = useMutation(api.accountDeletion.request);
  const retry = useMutation(api.accountDeletion.retry);
  const { signOut } = useAuthActions();
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const deleted = status?.kind === "deleted";

  useEffect(() => {
    if (!deleted) return;
    setCompleted(true);
    void signOut().catch(() => setSignOutFailed(true));
  }, [deleted, signOut]);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      if (status?.kind === "failed") await retry({});
      else await request({ confirmation });
    } catch (caught) {
      setError(
        caught instanceof ConvexError && typeof caught.data === "string"
          ? caught.data
          : "Could not start account deletion. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="route-page max-w-2xl">
      <h1 className="route-heading">
        {completed || deleted ? "Account deleted" : "Delete account"}
      </h1>
      <section className="surface-panel mt-8 p-5 sm:p-6">
        {completed || deleted ? (
          <>
            <p>Your profile and sign-in access have been removed.</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Your chats, messages, and files remain in TrailScout, linked to a deleted account.
            </p>
            {signOutFailed ? (
              <Button
                className="mt-6"
                onClick={() => {
                  void signOut()
                    .then(() => setSignOutFailed(false))
                    .catch(() => setSignOutFailed(true));
                }}
              >
                Sign out
              </Button>
            ) : (
              <Link to="/" className="mt-6 inline-block text-sm underline">
                Back to TrailScout
              </Link>
            )}
          </>
        ) : isLoading || (isAuthenticated && status === undefined) ? (
          <div className="min-h-40" aria-busy="true" />
        ) : !isAuthenticated || status?.kind === "signed_out" ? (
          <p>
            <Link to="/settings" className="underline">
              Sign in
            </Link>{" "}
            to delete your account.
          </p>
        ) : status?.kind === "unavailable" ? (
          <p>Your account is unavailable. Sign in with a verified account to continue.</p>
        ) : status?.kind === "deleting" ? (
          <div role="status">
            <p>Deleting your account…</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Your access is blocked while cleanup finishes. Chats, messages, and files are being
              kept. You can close this page.
            </p>
          </div>
        ) : status?.kind === "failed" ? (
          <>
            <p>Deletion could not finish.</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Your account remains disabled. Retry to finish removing your profile and sign-in
              access.
            </p>
            <Button
              className="mt-6"
              disabled={pending}
              onClick={() => {
                void submit();
              }}
            >
              {pending ? "Retrying…" : "Retry deletion"}
            </Button>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p>
              Deleting your account permanently removes your profile and sign-in access. This cannot
              be undone.
            </p>
            <p className="mt-4 font-medium">
              Your chats, messages, attachments, and Scout history will stay.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              They remain linked to a “Deleted account” record. Shared Scouts and their service
              accounts are kept.
            </p>
            <label htmlFor="delete-account-confirmation" className="mt-6 block text-sm">
              Type <strong>{ACCOUNT_DELETION_CONFIRMATION}</strong> to confirm
            </label>
            <Input
              id="delete-account-confirmation"
              className="mt-2"
              autoComplete="off"
              value={confirmation}
              disabled={pending}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <div className="mt-6 flex items-center gap-5">
              <Button
                type="submit"
                variant="destructive"
                disabled={pending || confirmation !== ACCOUNT_DELETION_CONFIRMATION}
              >
                {pending ? "Starting deletion…" : "Delete account"}
              </Button>
              <Link to="/settings" className="text-sm underline">
                Cancel
              </Link>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
      <footer className="mt-8">
        <LegalLinks />
      </footer>
    </main>
  );
}
