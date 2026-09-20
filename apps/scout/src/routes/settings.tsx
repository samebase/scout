import { useAuthActions } from "@convex-dev/auth/react";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Authenticated, Unauthenticated } from "convex/react";
import { LogOutIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { CreditsPanel } from "#components/credits-panel";
import { LegalLinks } from "#components/legal-links";
import { Button } from "#components/ui/button";
import { accountAccessMessage, useViewerAccess } from "#lib/access";
import { SessionRecordingSettings } from "../components/session-recording-settings";
import { resetAnalytics } from "../lib/posthog";

export const Route = createFileRoute("/settings")({
  ssr: false,
  staticData: { access: "access_account" },
  validateSearch: (search) => z.object({ purchase: z.string().optional() }).parse(search),
  head: () => ({
    meta: [{ title: "Settings | Scout" }],
  }),
  component: SettingsPage,
});

type SignOutState = { kind: "idle" } | { kind: "pending" } | { kind: "failed" };

function SettingsPage() {
  const { purchase } = Route.useSearch();
  return (
    <main className="route-page max-w-3xl">
      <header>
        <h1 className="route-heading">Settings</h1>
        <p className="mt-3 text-base text-muted-foreground">
          Manage your account and browser session.
        </p>
      </header>

      <Unauthenticated>
        <Navigate to="/" replace />
      </Unauthenticated>
      <Authenticated>
        <SessionSettings />
        <SessionRecordingSettings />
        <AccountStatus />
        <CreditsPanel purchaseId={purchase} />
        <section className="surface-panel mt-8 p-5 sm:p-6">
          <h2 className="text-base font-semibold">Delete account</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Remove your profile and sign-in access. Chats, messages, and files stay in Scout.
          </p>
          <Link
            to="/account-deletion"
            className="mt-4 inline-block text-sm text-destructive underline"
          >
            Delete my account
          </Link>
        </section>
      </Authenticated>
      <footer className="mt-8">
        <LegalLinks />
      </footer>
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
  const viewer = useViewerAccess();
  const navigate = useNavigate();
  const [state, setState] = useState<SignOutState>({ kind: "idle" });
  const isPending = state.kind === "pending";

  const onSignOut = async () => {
    if (isPending) {
      return;
    }

    setState({ kind: "pending" });
    resetAnalytics();
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
            {viewer?.kind === "account" && viewer.email ? (
              <p className="mt-1 break-all text-sm text-muted-foreground">{viewer.email}</p>
            ) : null}
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
