import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import {
  SidebarLayout,
  type SidebarLayoutResizeHandleLabels,
  type SidebarLayoutResizeHandleValueTextFormatter,
} from "@samebase/sidebars/SidebarLayout";
import { useSidebarActions, useSidebarLayoutPresentation } from "@samebase/sidebars/SidebarRuntime";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  PanelLeftIcon,
  PanelRightIcon,
  TerminalSquareIcon,
  VideoOffIcon,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import {
  scoutSidebarDesktopPrehydrationScript,
  scoutSidebarMobilePrehydrationScript,
} from "../sidebars/scoutSidebarState";
import { ServiceIcon } from "#components/service-icon";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/products/$domain/claims/$claimKey")({
  component: ProductClaimPage,
});

type Product = NonNullable<FunctionReturnType<typeof api.products.getByDomain>>;
type ResolvedClaim = NonNullable<FunctionReturnType<typeof api.products.getClaimByDomain>>;
type Claim = ResolvedClaim["claim"];

const CLAIM_RESIZE_HANDLE_LABELS = {
  left: "Resize claim list",
  right: "Resize claim activity",
} satisfies SidebarLayoutResizeHandleLabels;

const completedDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatResizeHandleValueText: SidebarLayoutResizeHandleValueTextFormatter = ({ widthPx }) =>
  `${widthPx} pixels wide`;

function ProductClaimPage() {
  const { claimKey, domain } = Route.useParams();
  const product = useQuery(api.products.getByDomain, { domain });
  const resolvedClaim = useQuery(api.products.getClaimByDomain, { claimKey, domain });
  const claims = product?.latestCompletedInvestigation?.result.claims ?? [];
  const loading = product === undefined || resolvedClaim === undefined;

  return (
    <>
      <SidebarLayout
        addressChrome={
          <ClaimWorkspaceChrome
            claim={resolvedClaim?.claim}
            loading={loading}
            product={product ?? undefined}
          />
        }
        formatResizeHandleValueText={formatResizeHandleValueText}
        left={
          <PaneFrame
            content={
              <ClaimNavigation
                domain={domain}
                product={product}
                selectedClaimKey={resolvedClaim?.claim.claimKey}
              />
            }
            footer={
              <div className="text-muted-foreground flex h-full items-center px-3 text-xs">
                {product === undefined
                  ? "Loading claims..."
                  : product === null
                    ? "Product not found"
                    : product.latestCompletedInvestigation === null
                      ? "No investigation"
                      : `${claims.length} ${claims.length === 1 ? "claim" : "claims"}`}
              </div>
            }
            header={
              <div className="flex h-full min-w-0 items-center gap-2 px-3">
                <Link
                  to="/products/$domain"
                  params={{ domain }}
                  className="inline-flex min-w-0 items-center gap-2 text-sm font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <ArrowLeftIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">Claims</span>
                </Link>
              </div>
            }
            scrollRestorationId={`claim-navigation:${domain}`}
          />
        }
        main={
          <PaneFrame
            content={
              <ClaimMain
                domain={domain}
                loading={loading}
                product={product ?? undefined}
                resolvedClaim={resolvedClaim ?? undefined}
                productMissing={product === null}
                claimMissing={resolvedClaim === null}
              />
            }
            scrollRestorationId={`claim-evidence:${domain}:${claimKey}`}
          />
        }
        right={
          <PaneFrame
            content={<ClaimActivityPane product={product} resolvedClaim={resolvedClaim} />}
            header={<ClaimActivityHeader product={product} resolvedClaim={resolvedClaim} />}
            scrollRestorationId={`claim-activity:${domain}:${claimKey}`}
          />
        }
        resizeHandleLabels={CLAIM_RESIZE_HANDLE_LABELS}
      />
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: scoutSidebarDesktopPrehydrationScript }}
      />
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: scoutSidebarMobilePrehydrationScript }}
      />
    </>
  );
}

function ClaimWorkspaceChrome({
  claim,
  loading,
  product,
}: {
  claim: Claim | undefined;
  loading: boolean;
  product: Product | undefined;
}) {
  const { setMobilePane, toggleLeftPane, toggleRightPane } = useSidebarActions();
  const { isMobile, leftDesktopOpen, mobilePane, rightDesktopOpen } =
    useSidebarLayoutPresentation();
  const claimsShown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  const activityShown = isMobile ? mobilePane === "right" : rightDesktopOpen;

  const toggleClaims = () => {
    if (isMobile) {
      setMobilePane(claimsShown ? "main" : "left");
      return;
    }
    toggleLeftPane();
  };

  const toggleActivity = () => {
    if (isMobile) {
      setMobilePane(activityShown ? "main" : "right");
      return;
    }
    toggleRightPane();
  };

  return (
    <div className="flex h-12 min-w-0 items-center gap-2 px-3">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={claimsShown ? "Hide claims" : "Show claims"}
        aria-pressed={claimsShown}
        onClick={toggleClaims}
      >
        <PanelLeftIcon />
      </Button>
      {product ? (
        <ServiceIcon
          serviceName={product.name}
          serviceDomain={product.domain}
          className="size-6 shrink-0 rounded-md"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium">
          {loading ? "Loading claim..." : (product?.name ?? "Claim not found")}
        </h1>
        <p className="text-muted-foreground truncate font-mono text-[0.6875rem]">
          {claim?.claim ?? product?.domain ?? ""}
        </p>
      </div>
      <Button asChild size="sm" variant="ghost">
        <Link to="/lab">
          <TerminalSquareIcon />
          Lab
        </Link>
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={activityShown ? "Hide claim activity" : "Show claim activity"}
        aria-pressed={activityShown}
        onClick={toggleActivity}
      >
        <PanelRightIcon />
      </Button>
    </div>
  );
}

function ClaimNavigation({
  domain,
  product,
  selectedClaimKey,
}: {
  domain: string;
  product: Product | null | undefined;
  selectedClaimKey: string | undefined;
}) {
  const { setMobilePane } = useSidebarActions();

  if (product === undefined) {
    return (
      <p className="text-muted-foreground px-3 py-8 text-center text-sm" role="status">
        Loading claims...
      </p>
    );
  }

  if (product === null) {
    return (
      <ClaimNavigationEmptyState
        title="Product not found."
        detail="Return to the registry and choose an available product."
      />
    );
  }

  const investigation = product.latestCompletedInvestigation;
  if (investigation === null) {
    return (
      <ClaimNavigationEmptyState
        title="No completed investigation."
        detail="Investigate this product before opening a claim."
      />
    );
  }

  const claims = investigation.result.claims;
  if (claims.length === 0) {
    return (
      <ClaimNavigationEmptyState
        title="No claims found."
        detail="The latest completed investigation did not return any claims."
      />
    );
  }

  return (
    <nav className="p-2" aria-label="Product claims">
      <ol className="space-y-1">
        {claims.map((claim) => {
          const selected = claim.claimKey === selectedClaimKey;
          return (
            <li key={claim.claimKey}>
              <Link
                to="/products/$domain/claims/$claimKey"
                params={{ claimKey: claim.claimKey, domain }}
                className="group block rounded-lg px-2.5 py-2.5 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[selected]:bg-sidebar-accent data-[selected]:text-sidebar-accent-foreground"
                data-selected={selected ? "" : undefined}
                aria-current={selected ? "page" : undefined}
                onClick={() => setMobilePane("main")}
              >
                <span className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.08em] uppercase">
                  {claim.category}
                </span>
                <span className="mt-1.5 block wrap-break-word text-sm font-medium leading-5">
                  {claim.claim}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ClaimNavigationEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-3 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm">{detail}</p>
    </div>
  );
}

function ClaimMain({
  claimMissing,
  domain,
  loading,
  product,
  productMissing,
  resolvedClaim,
}: {
  claimMissing: boolean;
  domain: string;
  loading: boolean;
  product: Product | undefined;
  productMissing: boolean;
  resolvedClaim: ResolvedClaim | undefined;
}) {
  if (loading) {
    return (
      <main className="mx-auto w-full max-w-5xl p-4 @md:p-6">
        <p className="text-muted-foreground py-16 text-center text-sm" role="status">
          Loading claim...
        </p>
      </main>
    );
  }

  if (productMissing || product === undefined) {
    return (
      <ClaimRouteEmptyState
        title="Product not found."
        detail="Choose another product from the registry."
      />
    );
  }

  if (product.latestCompletedInvestigation === null) {
    return (
      <ClaimRouteEmptyState
        title="No completed investigation."
        detail="Investigate this product before opening a claim."
        domain={domain}
      />
    );
  }

  if (product.latestCompletedInvestigation.result.claims.length === 0) {
    return (
      <ClaimRouteEmptyState
        title="No claims found."
        detail="The latest completed investigation did not return any claims."
        domain={domain}
      />
    );
  }

  if (claimMissing || resolvedClaim === undefined) {
    return (
      <ClaimRouteEmptyState
        title="Claim not found."
        detail="This claim is not part of the current product investigation."
        domain={domain}
      />
    );
  }

  const { claim, completedAt } = resolvedClaim;

  return (
    <main className="mx-auto w-full max-w-5xl p-4 @md:p-6 @xl:p-8">
      <Link
        to="/products/$domain"
        params={{ domain }}
        className="text-muted-foreground inline-flex items-center gap-1.5 text-xs outline-none hover:text-foreground hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
        {product.name}
      </Link>

      <article className="mt-5">
        <header className="border-l-2 border-blue-500 pl-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.1em] uppercase">
              {claim.category}
            </span>
          </div>
          <h2 className="mt-3 max-w-4xl wrap-break-word text-xl font-medium tracking-tight @md:text-2xl @xl:text-3xl">
            {claim.claim}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-3xl wrap-break-word text-sm leading-6">
            {claim.support}
          </p>
          <a
            href={claim.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground mt-3 inline-flex max-w-full items-center gap-1.5 text-xs underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="truncate">{claim.pageTitle || "Source"}</span>
            <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
          </a>
        </header>

        {claim.evidenceExcerpt || claim.qualifiers.length > 0 ? (
          <section className="mt-6 grid gap-4 @xl:grid-cols-2" aria-label="Research evidence">
            {claim.evidenceExcerpt ? (
              <div className="rounded-lg border p-4">
                <h3 className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.1em] uppercase">
                  Source evidence
                </h3>
                <p className="mt-2 wrap-break-word text-sm leading-6">{claim.evidenceExcerpt}</p>
              </div>
            ) : null}
            {claim.qualifiers.length > 0 ? (
              <div className="rounded-lg border p-4">
                <h3 className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.1em] uppercase">
                  Qualifiers
                </h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm leading-6">
                  {claim.qualifiers.map((qualifier, index) => (
                    <li key={`${index}:${qualifier}`} className="wrap-break-word pl-1">
                      {qualifier}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        <ClaimTestArea claim={claim} />

        <p className="text-muted-foreground mt-4 text-xs">
          Claim discovered {completedDate.format(completedAt)}
        </p>
      </article>
    </main>
  );
}

function ClaimTestArea({ claim }: { claim: Claim }) {
  return (
    <section className="mt-8 border-t pt-6" aria-labelledby="claim-test-heading">
      <div>
        <h3 id="claim-test-heading" className="text-base font-medium">
          Proposed test
        </h3>
        <p className="text-muted-foreground mt-1 max-w-3xl wrap-break-word text-sm leading-6">
          {claim.suggestedMysteryShop || "No mystery shop was proposed during research."}
        </p>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border bg-foreground text-background shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-background/15 px-3 py-2.5">
          <span className="font-mono text-[0.6875rem] tracking-[0.1em] uppercase">
            Browser evidence
          </span>
          <span className="text-background/60 text-xs">Lab not linked</span>
        </div>
        <div className="relative flex min-h-52 items-center justify-center overflow-hidden p-6 text-center @xl:aspect-video">
          <div
            className="pointer-events-none absolute inset-0 opacity-20"
            aria-hidden="true"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, currentColor 0.7px, transparent 0.8px)",
              backgroundSize: "18px 18px",
            }}
          />
          <div className="relative max-w-sm">
            <VideoOffIcon className="mx-auto size-6 text-background/60" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No browser evidence linked</p>
            <p className="mt-1 text-background/60 text-sm">
              This claim does not have a linked Lab experiment. Run and inspect the first experiment
              in Lab.
            </p>
          </div>
        </div>
      </div>

      <section
        className="mt-5 rounded-xl border p-4 @md:p-5"
        aria-labelledby="claim-result-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="claim-result-heading" className="text-sm font-medium">
            Result
          </h3>
          <span className="text-muted-foreground text-xs">Lab not linked</span>
        </div>
        <p className="text-muted-foreground mt-3 text-sm">
          Claim-level results are not connected yet. Inspect the experiment outcome in Lab.
        </p>
      </section>
    </section>
  );
}

function ClaimRouteEmptyState({
  detail,
  domain,
  title,
}: {
  detail: string;
  domain?: string;
  title: string;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl p-4 @md:p-6">
      <div className="py-16 text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-1 text-sm">{detail}</p>
        <Button asChild size="sm" variant="outline" className="mt-4">
          {domain ? (
            <Link to="/products/$domain" params={{ domain }}>
              Open product
            </Link>
          ) : (
            <Link to="/products">Open products</Link>
          )}
        </Button>
      </div>
    </main>
  );
}

function claimActivityStatus(
  product: Product | null | undefined,
  resolvedClaim: ResolvedClaim | null | undefined,
) {
  if (product === undefined || resolvedClaim === undefined) return "Loading...";
  if (product === null) return "No product";
  if (product.latestCompletedInvestigation === null) return "No investigation";
  if (product.latestCompletedInvestigation.result.claims.length === 0) return "No claims";
  if (resolvedClaim === null) return "No claim";
  return "Lab not linked";
}

function ClaimActivityHeader({
  product,
  resolvedClaim,
}: {
  product: Product | null | undefined;
  resolvedClaim: ResolvedClaim | null | undefined;
}) {
  return (
    <div className="flex h-full min-w-0 items-center justify-between gap-3 px-3">
      <span className="truncate text-sm font-medium">Claim activity</span>
      <span className="text-muted-foreground text-xs" aria-live="polite">
        {claimActivityStatus(product, resolvedClaim)}
      </span>
    </div>
  );
}

function ClaimActivityPane({
  product,
  resolvedClaim,
}: {
  product: Product | null | undefined;
  resolvedClaim: ResolvedClaim | null | undefined;
}) {
  if (product === undefined || resolvedClaim === undefined) {
    return (
      <p className="text-muted-foreground p-5 text-sm" role="status">
        Loading claim context...
      </p>
    );
  }

  if (product === null) {
    return (
      <ClaimActivityNotice
        title="Product not found"
        detail="Choose an available product from the registry."
      />
    );
  }

  if (product.latestCompletedInvestigation === null) {
    return (
      <ClaimActivityNotice
        title="No completed investigation"
        detail="Investigate the product before connecting a Lab experiment."
      />
    );
  }

  if (product.latestCompletedInvestigation.result.claims.length === 0) {
    return (
      <ClaimActivityNotice
        title="No claims found"
        detail="The latest completed investigation did not return a claim to connect."
      />
    );
  }

  if (resolvedClaim === null) {
    return (
      <ClaimActivityNotice
        title="Claim not found"
        detail="This claim is not part of the latest completed investigation."
      />
    );
  }

  return (
    <aside className="p-3 @md:p-4" aria-label="Claim activity details">
      <div className="rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">Lab activity is not linked</p>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          This research claim does not yet reference a Lab experiment.
        </p>
      </div>

      <section className="mt-5" aria-labelledby="activity-visibility-heading">
        <h2
          id="activity-visibility-heading"
          className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.1em] uppercase"
        >
          Current testing path
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Use Lab to run the experiment and inspect its agent messages, Firecrawl calls, browser
          actions, waits, retries, and errors.
        </p>
      </section>

      <Button asChild size="sm" variant="outline" className="mt-5 w-full">
        <Link to="/lab">
          <TerminalSquareIcon />
          Open Lab console
        </Link>
      </Button>
    </aside>
  );
}

function ClaimActivityNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <aside className="p-3 @md:p-4" aria-label="Claim activity details">
      <div className="rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-1 text-sm leading-6">{detail}</p>
      </div>
    </aside>
  );
}
