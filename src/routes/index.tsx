import { Link, createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import {
  ArrowRightIcon,
  CheckIcon,
  FlaskConicalIcon,
  PackageSearchIcon,
  TelescopeIcon,
  UsersIcon,
} from "lucide-react";
import { AuthPanel } from "#components/auth-panel";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <AuthLoading>
        <main className="grid min-h-[100dvh] place-items-center p-6">
          <p className="text-muted-foreground text-sm">Loading account...</p>
        </main>
      </AuthLoading>
      <Unauthenticated>
        <SignedOutHome />
      </Unauthenticated>
      <Authenticated>
        <SignedInHome />
      </Authenticated>
    </>
  );
}

function SignedOutHome() {
  return (
    <main className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(28rem,0.9fr)]">
      <section className="relative flex min-h-[48dvh] flex-col justify-between overflow-hidden bg-primary p-6 text-primary-foreground sm:p-10 lg:min-h-[100dvh] lg:p-14">
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-[0.625rem] bg-primary-foreground text-primary shadow-lg">
            <TelescopeIcon className="size-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-[-0.03em]">Scout</span>
        </div>

        <div className="relative my-14 max-w-2xl lg:my-20">
          <h1 className="max-w-[12ch] text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.92] font-semibold tracking-[-0.065em]">
            Test the promise.
          </h1>
          <p className="mt-6 max-w-[34rem] text-base leading-7 text-primary-foreground/90 sm:text-lg">
            Turn product claims into repeatable user journeys, sourced evidence, and clear verdicts.
          </p>
        </div>

        <ul className="relative grid gap-3 text-sm text-primary-foreground/90 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {[
            "Capture first-party claims",
            "Run with a fresh identity",
            "Record what actually happened",
          ].map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 border-t border-primary-foreground/20 pt-3"
            >
              <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-10 lg:p-14">
        <div className="w-full max-w-md">
          <p className="mb-7 text-sm font-medium text-muted-foreground">Administrator workspace</p>
          <AuthPanel />
        </div>
      </section>
    </main>
  );
}

function SignedInHome() {
  return (
    <main className="route-page">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold text-primary">Research workspace</p>
        <h1 className="route-heading mt-3">What should Scout inspect?</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          Collect a product's claims, assign a reusable Scout, then test the customer journey in
          Lab.
        </p>
      </header>

      <section className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <Link
          to="/products"
          className="group relative flex min-h-72 flex-col justify-between overflow-hidden rounded-[1rem] bg-primary p-6 text-primary-foreground outline-none shadow-[0_24px_60px_color-mix(in_oklch,var(--primary)_22%,transparent)] transition-transform hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/40 sm:p-8"
        >
          <PackageSearchIcon className="size-8" aria-hidden="true" />
          <div className="mt-16">
            <h2 className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Open products</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-primary-foreground/90">
              Gather first-party claims and launch a durable investigation.
            </p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">
              View registry
              <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
            </span>
          </div>
        </Link>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <WorkspaceLink
            to="/scouts"
            title="Manage Scouts"
            description="Give worker models persistent identities, inboxes, browser state, and accounts."
            icon={<UsersIcon />}
          />
          <WorkspaceLink
            to="/lab"
            title="Open Lab"
            description="Run focused product experiments and inspect every attempt."
            icon={<FlaskConicalIcon />}
          />
        </div>
      </section>
    </main>
  );
}

function WorkspaceLink({
  to,
  title,
  description,
  icon,
}: {
  to: "/lab" | "/scouts";
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="surface-panel group flex min-h-32 items-start gap-4 p-5 outline-none transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/35 focus-visible:ring-3 focus-visible:ring-ring/35"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-[0.625rem] bg-accent text-accent-foreground [&_svg]:size-5">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold tracking-[-0.02em]">{title}</span>
        <span className="mt-1.5 block text-sm leading-6 text-muted-foreground">{description}</span>
      </span>
      <ArrowRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
    </Link>
  );
}
