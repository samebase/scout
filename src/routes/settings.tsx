import { useAuthActions } from "@convex-dev/auth/react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useState } from "react";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings | Scout" },
      {
        name: "description",
        content: "Manage your Scout account.",
      },
    ],
  }),
  component: SettingsPage,
});

type SignOutState = { kind: "idle" } | { kind: "pending" } | { kind: "failed" };

function SettingsPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl">Settings</h1>
        <p className="text-muted-foreground">Manage your Scout account.</p>
      </header>

      <AuthLoading>
        <p className="text-muted-foreground text-sm">Loading account...</p>
      </AuthLoading>
      <Unauthenticated>
        <section className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-medium">Signed out</h2>
            <p className="text-muted-foreground text-sm">
              Sign in from the home page to manage your account.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/">Go to sign in</Link>
          </Button>
        </section>
      </Unauthenticated>
      <Authenticated>
        <SessionSettings />
      </Authenticated>
    </main>
  );
}

function SessionSettings() {
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const [state, setState] = useState<SignOutState>({ kind: "idle" });
  const isPending = state.kind === "pending";

  const onSignOut = async () => {
    if (isPending) {
      return;
    }

    setState({ kind: "pending" });
    try {
      await signOut();
      await navigate({ to: "/", replace: true });
    } catch {
      setState({ kind: "failed" });
    }
  };

  return (
    <section className="rounded-lg border p-4" aria-labelledby="session-settings-heading">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <h2 id="session-settings-heading" className="text-lg font-medium">
            Session
          </h2>
          <p className="text-muted-foreground text-sm">Sign out of Scout on this browser.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => void onSignOut()}
        >
          {isPending ? "Signing out" : "Sign out"}
        </Button>
      </div>
      {state.kind === "failed" ? (
        <p className="text-destructive mt-3 text-sm" role="alert">
          Could not sign out. Try again.
        </p>
      ) : null}
    </section>
  );
}
