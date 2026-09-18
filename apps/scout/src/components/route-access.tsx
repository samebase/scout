import { useAuthActions } from "@convex-dev/auth/react";
import { Link, Navigate, Outlet, useMatches } from "@tanstack/react-router";
import { useState } from "react";
import { accountAccessMessage, canAccess, useViewerAccess } from "../lib/access";
import { AuthPanel } from "./auth-panel";
import { Button } from "./ui/button";

export function RouteAccessOutlet() {
  const policies = useMatches({
    select: (matches) => matches.map((match) => match.staticData.access),
  });
  const accessibleAfterAccountClosure = useMatches({
    select: (matches) =>
      matches.some((match) => ["/account-deletion", "/privacy", "/terms"].includes(match.pathname)),
  });
  const viewer = useViewerAccess();
  if ((viewer?.kind === "deleting" || viewer?.kind === "deleted") && !accessibleAfterAccountClosure)
    return <Navigate to="/account-deletion" replace />;
  if (policies.every((access) => access === "access_public")) return <Outlet />;
  if (!viewer)
    return (
      <main className="route-page" role="status">
        Loading account…
      </main>
    );
  if (viewer.kind === "anonymous")
    return (
      <main className="route-page max-w-md">
        <h1 className="route-heading mb-6">Sign in to Scout</h1>
        <AuthPanel />
      </main>
    );
  if (
    viewer.kind === "account" &&
    policies.every((access) => access === "access_public" || canAccess(access, viewer.accessKeys))
  )
    return <Outlet />;
  return <AccessUnavailable />;
}

function AccessUnavailable() {
  const message = accountAccessMessage(useViewerAccess());
  const { signOut } = useAuthActions();
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  async function leave() {
    setPending(true);
    setFailed(false);
    try {
      await signOut();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="route-page max-w-2xl">
      <h1 className="route-heading">{message?.title ?? "Access unavailable"}</h1>
      <p className="mt-3 text-muted-foreground">
        {message?.description ?? "This page isn’t available for your account."}
      </p>
      <div className="mt-6 flex gap-4 items-center">
        <Link to="/" className="underline">
          Back to Scout
        </Link>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            void leave();
          }}
        >
          {pending ? "Signing out…" : "Sign out"}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="mt-3 text-destructive">
          Could not sign out. Try again.
        </p>
      )}
    </main>
  );
}
