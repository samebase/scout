import { useCompleteSignUp } from "@convex-dev/auth/methods/email-password/react";
import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { authErrorMessage } from "#components/auth-panel";

// The landing page of the sign-up link: it signs the new account in for the first time.
export const Route = createFileRoute("/verify-email")({
  ssr: false,
  staticData: { access: "access_public" },
  validateSearch: (search) => z.object({ code: z.string() }).parse(search),
  head: () => ({ meta: [{ title: "Verify email | TrailScout" }] }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { code } = Route.useSearch();
  const state = useCompleteSignUp(api.auth, { emailCode: code });
  if (state.status === "complete") return <Navigate to="/" replace />;
  return (
    <main className="route-page max-w-md" aria-busy={state.status === "loading"}>
      <h1 className="route-heading">Verify email</h1>
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
    </main>
  );
}
