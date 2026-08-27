import { useAuthActions } from "@convex-dev/auth/react";
import { createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useState } from "react";
import { ConvexClientProvider } from "../lib/convex";
import { AuthPanel } from "#components/auth-panel";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <ConvexClientProvider>
      <main className="mx-auto flex max-w-xl flex-col gap-6 p-4">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl">Scout</h1>
          <p className="text-muted-foreground">
            Test web apps through fresh-user journeys and record whether their claims hold.
          </p>
        </header>

        <AuthLoading>
          <p className="text-muted-foreground text-sm">Loading account...</p>
        </AuthLoading>
        <Unauthenticated>
          <AuthPanel />
        </Unauthenticated>
        <Authenticated>
          <SignedInControls />
        </Authenticated>
      </main>
    </ConvexClientProvider>
  );
}

function SignedInControls() {
  const { signOut } = useAuthActions();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const onSignOut = () => {
    setIsSigningOut(true);
    void signOut().finally(() => setIsSigningOut(false));
  };

  return (
    <section className="flex items-center justify-between gap-3 rounded-lg border p-4">
      <p className="text-sm">Signed in as the Scout administrator.</p>
      <Button type="button" variant="outline" disabled={isSigningOut} onClick={onSignOut}>
        {isSigningOut ? "Signing out" : "Sign out"}
      </Button>
    </section>
  );
}
