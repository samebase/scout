import { useAuthActions } from "@convex-dev/auth/react";
import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { LogOutIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#components/ui/button";
import { accountAccessMessage, useViewerAccess } from "#lib/access";

export const Route = createFileRoute("/settings")({
  staticData: { access: "access_account" },
  head: () => ({
    meta: [{ title: "Settings | Scout" }],
  }),
  component: SettingsPage,
});

type SignOutState = { kind: "idle" } | { kind: "pending" } | { kind: "failed" };

function SettingsPage() {
  return (
    <main className="route-page max-w-3xl">
      <header>
        <h1 className="route-heading">Settings</h1>
        <p className="mt-3 text-base text-muted-foreground">Manage this browser session.</p>
      </header>

      <AuthLoading>
        <p className="mt-8 text-muted-foreground text-sm">Loading account...</p>
      </AuthLoading>
      <Unauthenticated>
        <Navigate to="/" replace />
      </Unauthenticated>
      <Authenticated>
        <AccountStatus />
        <SessionSettings />
      </Authenticated>
    </main>
  );
}

function AccountStatus() {
  const viewer = useViewerAccess();
  const message = accountAccessMessage(viewer);
  if (viewer?.kind !== "account") return null;
  return (
    <section className="surface-panel mt-8 p-5 sm:p-6" aria-live="polite">
      <h2 className="text-base font-semibold">
        {message?.title ?? (viewer.role === "role_staff" ? "Admin access" : "Account approved")}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {message?.description ??
          `You have ${viewer.role === "role_staff" ? "admin" : "member"} access.`}
      </p>
    </section>
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
    <section className="surface-panel mt-8 p-5 sm:p-6" aria-labelledby="session-settings-heading">
      <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-[0.625rem] bg-accent text-accent-foreground">
            <ShieldCheckIcon className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="session-settings-heading" className="text-base font-semibold">
              Your session
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">You are signed in on this browser.</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => void onSignOut()}
        >
          <LogOutIcon aria-hidden="true" />
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
