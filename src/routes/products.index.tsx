import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { ServiceIcon } from "#components/service-icon";
import { Button } from "#components/ui/button";
import { Collapsible, CollapsibleContent } from "#components/ui/collapsible";
import { Input } from "#components/ui/input";

export const Route = createFileRoute("/products/")({
  component: ProductsIndexPage,
});

type Product = FunctionReturnType<typeof api.products.list>[number];
type Investigation = NonNullable<Product["latestInvestigation"]>;
type CompletedInvestigation = NonNullable<Product["latestCompletedInvestigation"]>;

type AddProductState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };

type InvestigationRequestState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };

type PageNotice = { kind: "added" | "existing" } | null;

type RegistrySyncState = { kind: "syncing" } | { kind: "done" } | { kind: "failed" };

const investigationDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const creditCount = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

function ProductsIndexPage() {
  const products = useQuery(api.products.list, {});
  const syncKnownProducts = useMutation(api.products.syncKnownProducts);
  const syncStarted = useRef(false);
  const [syncState, setSyncState] = useState<RegistrySyncState>({ kind: "syncing" });
  const [addOpen, setAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [notice, setNotice] = useState<PageNotice>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (syncStarted.current) {
      return;
    }
    syncStarted.current = true;
    let active = true;
    void (async () => {
      let continuation: { phase: "accounts" | "experiments"; cursor: string | null } | undefined;
      do {
        const result = await syncKnownProducts(continuation === undefined ? {} : { continuation });
        continuation = result.next ?? undefined;
      } while (continuation !== undefined);
      if (active) {
        setSyncState({ kind: "done" });
      }
    })().catch(() => {
      if (active) {
        setSyncState({ kind: "failed" });
      }
    });
    return () => {
      active = false;
    };
  }, [syncKnownProducts]);

  const loading = products === undefined || syncState.kind === "syncing";
  const loadedProducts = products ?? [];

  const closeAdd = () => {
    if (addSubmitting) {
      return;
    }
    setAddOpen(false);
    requestAnimationFrame(() => addButton.current?.focus());
  };

  const finishAdd = (created: boolean) => {
    setAddSubmitting(false);
    setAddOpen(false);
    setNotice({ kind: created ? "added" : "existing" });
    requestAnimationFrame(() => addButton.current?.focus());
  };

  return (
    <>
      <header className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
            Registry
          </p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">Products</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Products known through direct entry, Scout access, or Lab experiments.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {loading ? "Loading products..." : `Showing ${loadedProducts.length}`}
          </p>
          <Button
            ref={addButton}
            type="button"
            size="sm"
            aria-expanded={addOpen}
            aria-controls="add-product-panel"
            disabled={addSubmitting}
            onClick={() => {
              setNotice(null);
              setAddOpen((open) => !open);
            }}
          >
            {addOpen ? <XIcon /> : <PlusIcon />}
            {addOpen ? "Close" : "Add product"}
          </Button>
        </div>
      </header>

      {addOpen ? (
        <AddProductForm
          onCancel={closeAdd}
          onAdded={finishAdd}
          onSubmittingChange={setAddSubmitting}
        />
      ) : null}

      {notice ? (
        <p className="text-muted-foreground text-sm" role="status">
          {notice.kind === "added" ? "Product added." : "That product was already in the registry."}
        </p>
      ) : null}

      {syncState.kind === "failed" ? (
        <p className="text-destructive text-sm" role="alert">
          Existing Scout accounts and Lab experiments could not be synced. Reload to try again.
        </p>
      ) : null}

      {loading ? (
        <p
          className="text-muted-foreground rounded-xl border px-4 py-10 text-center text-sm"
          role="status"
        >
          Loading products...
        </p>
      ) : loadedProducts.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center">
          <p className="text-sm font-medium">No products yet.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Add a product to investigate what it promises customers.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label="Products">
          {loadedProducts.map((product) => (
            <ProductRow key={product._id} product={product} />
          ))}
        </ul>
      )}
    </>
  );
}

function AddProductForm({
  onCancel,
  onAdded,
  onSubmittingChange,
}: {
  onCancel: () => void;
  onAdded: (created: boolean) => void;
  onSubmittingChange: (submitting: boolean) => void;
}) {
  const createProduct = useMutation(api.products.create);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<AddProductState>({ kind: "idle" });
  const submitting = state.kind === "submitting";
  const domain = productDomainPreview(url);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const productUrl = url.trim();
    if (!productUrl) {
      setState({ kind: "failed", message: "Enter a product URL or domain." });
      return;
    }

    setState({ kind: "submitting" });
    onSubmittingChange(true);
    try {
      const productName = name.trim();
      const result = await createProduct({
        url: productUrl,
        ...(productName ? { name: productName } : {}),
      });
      onAdded(result.created);
    } catch (error) {
      onSubmittingChange(false);
      setState({ kind: "failed", message: addProductError(error) });
    }
  };

  const updateUrl = (value: string) => {
    setUrl(value);
    if (state.kind === "failed") {
      setState({ kind: "idle" });
    }
  };

  return (
    <section
      id="add-product-panel"
      className="bg-card rounded-xl border p-4 sm:p-5"
      aria-labelledby="add-product-heading"
    >
      <h2 id="add-product-heading" className="text-lg font-medium">
        Add product
      </h2>
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <FormField
          label="Product URL or domain"
          htmlFor="product-url"
          hint={domain ? `Will add ${domain}` : undefined}
        >
          <Input
            id="product-url"
            aria-describedby={domain ? "product-url-hint" : undefined}
            name="url"
            value={url}
            inputMode="url"
            autoComplete="url"
            placeholder="samebase.com"
            autoFocus
            required
            maxLength={2_048}
            disabled={submitting}
            onChange={(event) => updateUrl(event.currentTarget.value)}
          />
        </FormField>
        <FormField label="Product name" htmlFor="product-name" hint="Optional">
          <Input
            id="product-name"
            aria-describedby="product-name-hint"
            name="name"
            value={name}
            autoComplete="organization"
            placeholder="Derived from the domain"
            maxLength={120}
            disabled={submitting}
            onChange={(event) => {
              setName(event.currentTarget.value);
              if (state.kind === "failed") {
                setState({ kind: "idle" });
              }
            }}
          />
        </FormField>

        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
            {submitting ? "Adding" : "Add product"}
          </Button>
        </div>
        {state.kind === "failed" ? (
          <p className="text-destructive text-sm sm:col-span-2" role="alert">
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function ProductRow({ product }: { product: Product }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [requestState, setRequestState] = useState<InvestigationRequestState>({ kind: "idle" });
  const latest = product.latestInvestigation;
  const report = latest?.status === "completed" ? latest : product.latestCompletedInvestigation;

  return (
    <li className={`border-l-2 ${investigationBorderClass(latest?.status)}`}>
      <article className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-start gap-3">
            <ServiceIcon
              serviceName={product.name}
              serviceDomain={product.domain}
              className="mt-0.5 size-7 rounded-lg"
            />
            <div className="min-w-0">
              <h2 className="wrap-break-word text-base font-medium">{product.name}</h2>
              <a
                href={product.primaryUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground mt-1 inline-flex max-w-full items-center gap-1 font-mono text-xs underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="truncate">{product.domain}</span>
                <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
              </a>
            </div>
          </div>
          <InvestigationStatus investigation={latest} />
        </div>

        <div className="mt-5 grid gap-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">Scout access</dt>
              <dd className="mt-1">
                <ScoutAccess access={product.scoutAccess} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Lab experiments</dt>
              <dd className="mt-1">
                {product.experimentCount}{" "}
                {product.experimentCount === 1 ? "experiment" : "experiments"}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {report ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-expanded={reportOpen}
                aria-controls={`product-investigation-${product._id}`}
                onClick={() => setReportOpen((open) => !open)}
              >
                {reportOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                {reportOpen ? "Hide investigation" : reportButtonLabel(latest)}
              </Button>
            ) : null}
            <InvestigationAction
              productId={product._id}
              investigation={latest}
              state={requestState}
              onStateChange={setRequestState}
            />
          </div>
        </div>

        {latest?.status === "failed" ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <p className="text-destructive text-sm font-medium">Investigation failed</p>
            <p className="text-muted-foreground mt-1 wrap-break-word text-sm">{latest.failure}</p>
            {report ? (
              <p className="text-muted-foreground mt-1 text-xs">
                The last completed investigation is still available.
              </p>
            ) : null}
          </div>
        ) : null}

        {requestState.kind === "failed" ? (
          <p className="text-destructive mt-3 text-sm" role="alert">
            {requestState.message}
          </p>
        ) : null}

        {report ? (
          <Collapsible open={reportOpen} onOpenChange={setReportOpen}>
            <CollapsibleContent id={`product-investigation-${product._id}`}>
              <InvestigationReport investigation={report} />
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </article>
    </li>
  );
}

function ScoutAccess({ access }: { access: Product["scoutAccess"] }) {
  if (access.length === 0) {
    return <span className="text-muted-foreground">No registered accounts</span>;
  }

  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {access.map((scout) => (
        <span key={scout.scoutId} className="inline-flex items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full ${accessDotClass(scout.authenticationEvidence)}`}
            aria-hidden="true"
          />
          <span>
            {scout.displayName}, {scout.accountCount}{" "}
            {scout.accountCount === 1 ? "account" : "accounts"}
            <span className="text-muted-foreground">
              {` · ${accessEvidenceLabel(scout.authenticationEvidence)}`}
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}

function InvestigationStatus({ investigation }: { investigation: Investigation | null }) {
  if (investigation === null) {
    return (
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-2 text-sm">
        <span className="bg-muted-foreground size-2 rounded-full" aria-hidden="true" />
        Not investigated
      </span>
    );
  }

  switch (investigation.status) {
    case "queued":
      return (
        <StatusLabel dotClass="bg-amber-500" label="Queued" detail={investigation.requestedAt} />
      );
    case "running":
      return (
        <StatusLabel
          dotClass="bg-blue-500"
          label="Investigating"
          detail={investigation.startedAt}
        />
      );
    case "completed":
      return (
        <StatusLabel
          dotClass="bg-emerald-500"
          label="Investigated"
          detail={investigation.completedAt}
          credits={investigation.creditsUsed}
        />
      );
    case "failed":
      return (
        <StatusLabel
          dotClass="bg-destructive"
          label="Failed"
          detail={investigation.failedAt}
          credits={investigation.creditsUsed}
        />
      );
    default: {
      const exhaustive: never = investigation;
      return exhaustive;
    }
  }
}

function StatusLabel({
  dotClass,
  label,
  detail,
  credits,
}: {
  dotClass: string;
  label: string;
  detail: number;
  credits?: number | null;
}) {
  return (
    <span className="inline-flex shrink-0 items-start gap-2 text-right text-sm">
      <span className={`mt-1.5 size-2 rounded-full ${dotClass}`} aria-hidden="true" />
      <span>
        <span className="block">{label}</span>
        <span className="text-muted-foreground block text-xs">
          {investigationDate.format(detail)}
          {credits === undefined || credits === null
            ? null
            : ` · ${creditCount.format(credits)} Firecrawl credits`}
        </span>
      </span>
    </span>
  );
}

function InvestigationAction({
  productId,
  investigation,
  state,
  onStateChange,
}: {
  productId: Product["_id"];
  investigation: Investigation | null;
  state: InvestigationRequestState;
  onStateChange: (state: InvestigationRequestState) => void;
}) {
  const startInvestigation = useMutation(api.products.startInvestigation);
  const submitting = state.kind === "submitting";

  if (investigation?.status === "queued" || investigation?.status === "running") {
    return (
      <Button type="button" size="sm" disabled>
        <LoaderCircleIcon className="animate-spin" />
        {investigation.status === "queued" ? "Queued" : "Investigating"}
      </Button>
    );
  }

  const actionLabel =
    investigation === null
      ? "Investigate claims"
      : investigation.status === "completed"
        ? "Refresh investigation"
        : "Retry investigation";

  const request = async () => {
    if (submitting) {
      return;
    }
    onStateChange({ kind: "submitting" });
    try {
      await startInvestigation({ productId });
      onStateChange({ kind: "idle" });
    } catch {
      onStateChange({
        kind: "failed",
        message: "Could not start the investigation. Try again.",
      });
    }
  };

  return (
    <Button type="button" size="sm" disabled={submitting} onClick={() => void request()}>
      {submitting ? (
        <LoaderCircleIcon className="animate-spin" />
      ) : investigation === null ? (
        <SearchIcon />
      ) : (
        <RefreshCwIcon />
      )}
      {submitting ? "Starting" : actionLabel}
    </Button>
  );
}

function InvestigationReport({ investigation }: { investigation: CompletedInvestigation }) {
  const suggestedShops = uniqueSuggestedShops(investigation.result.claims);

  return (
    <section className="mt-5 border-t pt-5" aria-label="Investigation result">
      <div className="mb-6 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
        <p className="font-medium">Discovered claims, not verified results</p>
        <p className="text-muted-foreground mt-1">
          Scout found these claims in first-party materials. A mystery shop still needs to test
          whether they hold.
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          Completed {investigationDate.format(investigation.completedAt)}
          {` · ${creditCount.format(investigation.creditsUsed)} Firecrawl credits`}
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <ReportSection title="Summary" className="sm:col-span-2">
          <p className="wrap-break-word text-sm leading-6">{investigation.result.summary}</p>
        </ReportSection>

        <ReportSection title="Tensions" className="sm:col-span-2">
          {investigation.result.tensions.length === 0 ? (
            <EmptyReportValue />
          ) : (
            <ul className="space-y-3">
              {investigation.result.tensions.map((tension, tensionIndex) => (
                <li
                  key={`${tensionIndex}:${tension.summary}`}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
                >
                  <p className="wrap-break-word text-sm font-medium">{tension.summary}</p>
                  <ul className="mt-2 space-y-2">
                    {tension.evidence.map((evidence, evidenceIndex) => (
                      <li key={`${evidenceIndex}:${evidence.sourceUrl}`} className="text-sm">
                        {evidence.evidenceExcerpt ? (
                          <p className="text-muted-foreground wrap-break-word leading-6">
                            {evidence.evidenceExcerpt}
                          </p>
                        ) : null}
                        <SourceLink
                          href={evidence.sourceUrl}
                          label={evidence.pageTitle || "Source"}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </ReportSection>

        <ReportSection title="Audience">
          {investigation.result.audiences.length === 0 ? (
            <EmptyReportValue />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {investigation.result.audiences.map((audience) => (
                <li key={audience} className="wrap-break-word">
                  {audience}
                </li>
              ))}
            </ul>
          )}
        </ReportSection>

        <ReportSection title="Access">
          <AccessSummary access={investigation.result.access} />
        </ReportSection>

        <ReportSection title="Dependencies">
          {investigation.result.dependencies.length === 0 ? (
            <EmptyReportValue />
          ) : (
            <ul className="space-y-3 text-sm">
              {investigation.result.dependencies.map((dependency) => (
                <li key={`${dependency.name}:${dependency.sourceUrl}`}>
                  <p className="wrap-break-word font-medium">{dependency.name}</p>
                  <p className="text-muted-foreground mt-0.5 wrap-break-word">
                    {dependency.relationship}
                  </p>
                  <SourceLink href={dependency.sourceUrl} label="Source" />
                </li>
              ))}
            </ul>
          )}
        </ReportSection>

        <ReportSection
          title={`Claims (${investigation.result.claims.length})`}
          className="sm:col-span-2"
        >
          {investigation.result.claims.length === 0 ? (
            <EmptyReportValue />
          ) : (
            <ul className="divide-y rounded-lg border">
              {investigation.result.claims.map((claim, index) => (
                <li key={`${index}:${claim.claim}:${claim.sourceUrl}`} className="p-3 sm:p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <p className="wrap-break-word text-sm font-medium">{claim.claim}</p>
                    <span className="text-muted-foreground shrink-0 text-xs">{claim.category}</span>
                  </div>
                  <p className="text-muted-foreground mt-2 wrap-break-word text-sm leading-6">
                    {claim.support}
                  </p>
                  {claim.evidenceExcerpt ? (
                    <p className="mt-2 border-l-2 pl-3 wrap-break-word text-sm leading-6">
                      {claim.evidenceExcerpt}
                    </p>
                  ) : null}
                  {claim.qualifiers.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-muted-foreground text-xs">Qualifiers</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
                        {claim.qualifiers.map((qualifier, qualifierIndex) => (
                          <li
                            key={`${qualifierIndex}:${qualifier}`}
                            className="wrap-break-word pl-1"
                          >
                            {qualifier}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <SourceLink href={claim.sourceUrl} label={claim.pageTitle || "Source"} />
                </li>
              ))}
            </ul>
          )}
        </ReportSection>

        <ReportSection title="Suggested mystery shops">
          {suggestedShops.length === 0 ? (
            <EmptyReportValue />
          ) : (
            <ul className="list-disc space-y-2 pl-4 text-sm">
              {suggestedShops.map((shop) => (
                <li key={shop} className="wrap-break-word pl-1">
                  {shop}
                </li>
              ))}
            </ul>
          )}
        </ReportSection>

        <ReportSection title="Unknowns">
          {investigation.result.unknowns.length === 0 ? (
            <EmptyReportValue />
          ) : (
            <ul className="list-disc space-y-2 pl-4 text-sm">
              {investigation.result.unknowns.map((unknown) => (
                <li key={unknown} className="wrap-break-word pl-1">
                  {unknown}
                </li>
              ))}
            </ul>
          )}
        </ReportSection>

        <ReportSection
          title={`Sources (${investigation.result.sources.length})`}
          className="sm:col-span-2"
        >
          {investigation.result.sources.length === 0 ? (
            <EmptyReportValue />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {investigation.result.sources.map((source) => (
                <li key={source.url} className="min-w-0">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground inline-flex max-w-full items-start gap-1.5 text-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="wrap-break-word">{source.title || source.url}</span>
                    <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </ReportSection>
      </div>
    </section>
  );
}

function ReportSection({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <h3 className="text-muted-foreground mb-2 font-mono text-[0.6875rem] tracking-[0.12em] uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function EmptyReportValue() {
  return <p className="text-muted-foreground text-sm">None reported.</p>;
}

function AccessSummary({ access }: { access: CompletedInvestigation["result"]["access"] }) {
  return (
    <div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Signup</dt>
          <dd className="text-right">{signupStateLabel(access.signupState)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Entry</dt>
          <dd className="text-right">{freeEntryLabel(access.freeEntry)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Payment method</dt>
          <dd className="text-right">{paymentMethodLabel(access.paymentMethodRequired)}</dd>
        </div>
      </dl>
      {access.requirements.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1.5 pl-4 text-sm">
          {access.requirements.map((requirement, index) => (
            <li key={`${index}:${requirement}`} className="wrap-break-word pl-1">
              {requirement}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground mt-1.5 inline-flex items-center gap-1 text-xs underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {label}
      <ExternalLinkIcon className="size-3" aria-hidden="true" />
    </a>
  );
}

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {hint ? (
        <span id={`${htmlFor}-hint`} className="text-muted-foreground ml-2 text-xs">
          {hint}
        </span>
      ) : null}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function productDomainPreview(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return hostname.includes(".") ? hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function addProductError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const knownMessages = [
    "Product URL must use HTTP or HTTPS",
    "Product URL must be a valid hostname or URL",
    "Product URL must not include credentials",
    "Product name must be 120 characters or fewer",
    "Product registry can contain at most 200 products",
  ] as const;

  for (const known of knownMessages) {
    if (message.includes(known)) {
      return `${known}.`;
    }
  }
  return "Could not add the product. Check the URL and try again.";
}

function reportButtonLabel(investigation: Investigation | null) {
  return investigation?.status === "completed" ? "Show investigation" : "Show last investigation";
}

function uniqueSuggestedShops(claims: CompletedInvestigation["result"]["claims"]) {
  const seen = new Set<string>();
  const shops: string[] = [];
  for (const claim of claims) {
    const shop = claim.suggestedMysteryShop.trim();
    if (shop && !seen.has(shop)) {
      seen.add(shop);
      shops.push(shop);
    }
  }
  return shops;
}

function investigationBorderClass(status: Investigation["status"] | undefined) {
  switch (status) {
    case undefined:
      return "border-l-transparent";
    case "queued":
      return "border-l-amber-500";
    case "running":
      return "border-l-blue-500";
    case "completed":
      return "border-l-emerald-500";
    case "failed":
      return "border-l-destructive";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function accessDotClass(evidence: Product["scoutAccess"][number]["authenticationEvidence"]) {
  switch (evidence) {
    case "none":
      return "bg-muted-foreground";
    case "succeeded":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    default: {
      const exhaustive: never = evidence;
      return exhaustive;
    }
  }
}

function accessEvidenceLabel(evidence: Product["scoutAccess"][number]["authenticationEvidence"]) {
  switch (evidence) {
    case "none":
      return "authentication unverified";
    case "succeeded":
      return "authenticated";
    case "failed":
      return "authentication failed";
    default: {
      const exhaustive: never = evidence;
      return exhaustive;
    }
  }
}

function signupStateLabel(state: CompletedInvestigation["result"]["access"]["signupState"]) {
  switch (state) {
    case "open":
      return "Open";
    case "waitlist":
      return "Waitlist";
    case "invite_only":
      return "Invite only";
    case "unknown":
      return "Unknown";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function freeEntryLabel(entry: CompletedInvestigation["result"]["access"]["freeEntry"]) {
  switch (entry) {
    case "yes":
      return "Free access";
    case "trial":
      return "Trial";
    case "no":
      return "Paid";
    case "unknown":
      return "Unknown";
    default: {
      const exhaustive: never = entry;
      return exhaustive;
    }
  }
}

function paymentMethodLabel(
  requirement: CompletedInvestigation["result"]["access"]["paymentMethodRequired"],
) {
  switch (requirement) {
    case "yes":
      return "Required";
    case "no":
      return "Not required";
    case "unknown":
      return "Unknown";
    default: {
      const exhaustive: never = requirement;
      return exhaustive;
    }
  }
}
