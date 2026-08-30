import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import {
  SidebarLayout,
  type SidebarLayoutResizeHandleLabels,
  type SidebarLayoutResizeHandleValueTextFormatter,
} from "@samebase/sidebars/SidebarLayout";
import { useSidebarActions, useSidebarLayoutPresentation } from "@samebase/sidebars/SidebarRuntime";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
  scoutSidebarDesktopPrehydrationScript,
  scoutSidebarMobilePrehydrationScript,
} from "../sidebars/scoutSidebarState";
import { ServiceIcon } from "#components/service-icon";
import { Button } from "#components/ui/button";
import { Collapsible, CollapsibleContent } from "#components/ui/collapsible";
import { Input } from "#components/ui/input";

type Product = FunctionReturnType<typeof api.products.list>[number];
type Investigation = NonNullable<Product["latestInvestigation"]>;
type CompletedInvestigation = NonNullable<Product["latestCompletedInvestigation"]>;
type InvestigationInspector = NonNullable<
  FunctionReturnType<typeof api.productsInvestigationInspector.get>
>;
type ClaimTestStatuses = FunctionReturnType<typeof api.claimTests.listStatuses>;
type ClaimTestListState = ClaimTestStatuses[number]["state"] | "loading";

type AddProductState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };

type InvestigationRequestState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };

type ResearchResetState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string }
  | { kind: "done" };

type PageNotice = { kind: "added" | "existing" } | null;

type RegistrySyncState = { kind: "syncing" } | { kind: "done" } | { kind: "failed" };

const investigationDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const creditCount = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

const PRODUCT_RESIZE_HANDLE_LABELS = {
  left: "Resize product list",
  right: "Resize investigation activity",
} satisfies SidebarLayoutResizeHandleLabels;

const formatResizeHandleValueText: SidebarLayoutResizeHandleValueTextFormatter = ({ widthPx }) =>
  `${widthPx} pixels wide`;

export function ProductsWorkspace({ domain }: { domain?: string }) {
  const navigate = useNavigate();
  const products = useQuery(api.products.list, {});
  const routedProduct = useQuery(
    api.products.getByDomain,
    domain === undefined ? "skip" : { domain },
  );
  const syncKnownProducts = useMutation(api.products.syncKnownProducts);
  const { setMobilePane } = useSidebarActions();
  const syncPromise = useRef<Promise<void> | null>(null);
  const [syncState, setSyncState] = useState<RegistrySyncState>({ kind: "syncing" });
  const [addOpen, setAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [notice, setNotice] = useState<PageNotice>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (syncPromise.current === null) {
      syncPromise.current = (async () => {
        let continuation: { phase: "accounts" | "experiments"; cursor: string | null } | undefined;
        do {
          const result = await syncKnownProducts(
            continuation === undefined ? {} : { continuation },
          );
          continuation = result.next ?? undefined;
        } while (continuation !== undefined);
      })();
    }

    let active = true;
    void syncPromise.current
      .then(() => {
        if (active) {
          setSyncState({ kind: "done" });
        }
      })
      .catch(() => {
        if (active) {
          setSyncState({ kind: "failed" });
        }
      });
    return () => {
      active = false;
    };
  }, [syncKnownProducts]);

  const loading =
    products === undefined ||
    syncState.kind === "syncing" ||
    (domain !== undefined && routedProduct === undefined);
  const loadedProducts = products ?? [];
  const selectedProduct = domain === undefined ? undefined : (routedProduct ?? undefined);
  const selectedInvestigationId = selectedProduct?.latestInvestigation?._id;
  const inspector = useQuery(
    api.productsInvestigationInspector.get,
    selectedInvestigationId === undefined ? "skip" : { investigationId: selectedInvestigationId },
  );

  useEffect(() => {
    const firstProduct = loadedProducts[0];
    if (domain !== undefined || loading || firstProduct === undefined) {
      return;
    }

    void navigate({
      to: "/products/$domain",
      params: { domain: firstProduct.domain },
      replace: true,
    });
  }, [domain, loadedProducts, loading, navigate]);

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

  const selectProduct = (productDomain: string) => {
    void navigate({
      to: "/products/$domain",
      params: { domain: productDomain },
    }).then(() => {
      requestAnimationFrame(() => setMobilePane("main"));
    });
  };

  const toggleAdd = () => {
    setNotice(null);
    setAddOpen((open) => !open);
    setMobilePane("main");
  };

  return (
    <>
      <SidebarLayout
        addressChrome={
          <ProductsChrome
            activityState={inspector?.state}
            addButton={addButton}
            addOpen={addOpen}
            addSubmitting={addSubmitting}
            loading={loading}
            productCount={loadedProducts.length}
            onToggleAdd={toggleAdd}
          />
        }
        formatResizeHandleValueText={formatResizeHandleValueText}
        left={
          <PaneFrame
            content={
              <ProductNavigation
                loading={loading}
                products={loadedProducts}
                selectedProductId={selectedProduct?._id}
                onSelect={selectProduct}
              />
            }
            footer={
              <div className="text-muted-foreground flex h-full items-center px-3 text-xs">
                {loading
                  ? "Loading products..."
                  : `${loadedProducts.length} ${loadedProducts.length === 1 ? "product" : "products"}`}
              </div>
            }
            header={
              <div className="flex h-full items-center px-3 text-sm font-semibold">Registry</div>
            }
            scrollRestorationId="products-navigation"
          />
        }
        main={
          <PaneFrame
            content={
              <ProductsMain
                addOpen={addOpen}
                loading={loading}
                notice={notice}
                selectedProduct={selectedProduct}
                inspector={inspector}
                hasProducts={loadedProducts.length > 0}
                selectionMissing={domain !== undefined && routedProduct === null}
                syncState={syncState}
                onAddCancel={closeAdd}
                onAddFinished={finishAdd}
                onAddSubmittingChange={setAddSubmitting}
              />
            }
            scrollRestorationId="product-dossier"
          />
        }
        right={
          <PaneFrame
            content={
              <InvestigationActivityPane
                inspector={inspector}
                investigationId={selectedInvestigationId}
                productName={selectedProduct?.name}
              />
            }
            footer={<InvestigationActivityFooter inspector={inspector} />}
            header={<InvestigationActivityHeader inspector={inspector} />}
            scrollRestorationId="product-investigation-activity"
          />
        }
        resizeHandleLabels={PRODUCT_RESIZE_HANDLE_LABELS}
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

function ProductsChrome({
  activityState,
  addButton,
  addOpen,
  addSubmitting,
  loading,
  productCount,
  onToggleAdd,
}: {
  activityState: InvestigationInspector["state"] | undefined;
  addButton: RefObject<HTMLButtonElement | null>;
  addOpen: boolean;
  addSubmitting: boolean;
  loading: boolean;
  productCount: number;
  onToggleAdd: () => void;
}) {
  const { setMobilePane, toggleLeftPane, toggleRightPane } = useSidebarActions();
  const { isMobile, leftDesktopOpen, mobilePane, rightDesktopOpen } =
    useSidebarLayoutPresentation();
  const productsShown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  const activityShown = isMobile ? mobilePane === "right" : rightDesktopOpen;

  const toggleProducts = () => {
    if (isMobile) {
      setMobilePane(productsShown ? "main" : "left");
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
    <div className="flex h-12 min-w-0 items-center gap-2 px-2 sm:px-4">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={productsShown ? "Hide products" : "Show products"}
        aria-pressed={productsShown}
        onClick={toggleProducts}
      >
        <PanelLeftIcon />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">Products</h1>
        <p className="text-muted-foreground hidden truncate text-xs sm:block">
          First-party claims and investigations
        </p>
      </div>
      <p className="sr-only" aria-live="polite">
        {loading ? "Loading..." : `${productCount} ${productCount === 1 ? "product" : "products"}`}
      </p>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={activityShown ? "Hide investigation activity" : "Show investigation activity"}
        aria-pressed={activityShown}
        onClick={toggleActivity}
      >
        <span className="relative">
          <PanelRightIcon />
          {activityState === "running" ||
          activityState === "queued" ||
          activityState === "failed" ? (
            <span
              className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full ${
                activityState === "failed" ? "bg-destructive" : "bg-blue-500"
              }`}
              aria-hidden="true"
            />
          ) : null}
        </span>
      </Button>
      <Button
        ref={addButton}
        type="button"
        size="sm"
        aria-expanded={addOpen}
        aria-controls="add-product-panel"
        disabled={addSubmitting}
        onClick={onToggleAdd}
      >
        {addOpen ? <XIcon /> : <PlusIcon />}
        {addOpen ? "Close" : "Add product"}
      </Button>
    </div>
  );
}

function InvestigationActivityHeader({
  inspector,
}: {
  inspector: InvestigationInspector | null | undefined;
}) {
  return (
    <div className="flex h-full min-w-0 items-center justify-between gap-3 px-3">
      <span className="truncate text-sm font-semibold">Activity</span>
      <span className="text-muted-foreground text-xs" aria-live="polite">
        {inspector === undefined
          ? ""
          : inspector === null
            ? "No workflow"
            : investigationStateLabel(inspector.state)}
      </span>
    </div>
  );
}

function InvestigationActivityFooter({
  inspector,
}: {
  inspector: InvestigationInspector | null | undefined;
}) {
  if (inspector === undefined || inspector === null) {
    return <div className="h-full" />;
  }
  const startedAt = inspector.startedAt ?? inspector.requestedAt;
  const duration = inspector.finishedAt === null ? null : inspector.finishedAt - startedAt;
  return (
    <div className="text-muted-foreground flex h-full items-center justify-between gap-3 px-3 text-xs">
      <span>
        {creditCount.format(inspector.firecrawlCredits.used)} / {inspector.firecrawlCredits.maximum}{" "}
        Firecrawl credits
      </span>
      {duration === null ? null : <span>{formatDuration(duration)}</span>}
    </div>
  );
}

function InvestigationActivityPane({
  inspector,
  investigationId,
  productName,
}: {
  inspector: InvestigationInspector | null | undefined;
  investigationId: Investigation["_id"] | undefined;
  productName: string | undefined;
}) {
  const hasRunningActivity =
    inspector?.activities.some((activity) => activity.lifecycle.status === "running") ?? false;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasRunningActivity) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasRunningActivity]);

  if (investigationId === undefined) {
    return (
      <div className="text-muted-foreground p-5 text-sm">
        <p>No investigation yet.</p>
        <p className="mt-2 text-xs">Start one to see every provider call and Workflow step.</p>
      </div>
    );
  }
  if (inspector === undefined) {
    return (
      <p className="text-muted-foreground p-5 text-sm" role="status">
        Loading investigation activity...
      </p>
    );
  }
  if (inspector === null) {
    return (
      <div className="text-muted-foreground p-5 text-sm">
        <p>Detailed activity is unavailable for this investigation.</p>
        <p className="mt-2 text-xs">Refresh it to run the new durable Workflow.</p>
      </div>
    );
  }
  const announcedActivity =
    inspector.activities.find((activity) => activity.lifecycle.status === "running") ??
    inspector.activities.at(-1);

  return (
    <div className="p-3">
      <section
        className="rounded-[0.75rem] border bg-card p-3.5 shadow-[0_6px_20px_color-mix(in_oklch,var(--foreground)_4%,transparent)]"
        aria-label="Workflow run"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{productName ?? "Product"} investigation</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Requested {investigationDate.format(inspector.requestedAt)}
            </p>
          </div>
          <ActivityStatusBadge status={inspector.state} />
        </div>
        <dl className="mt-3 grid gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Workflow ID</dt>
            <dd className="mt-0.5 break-all font-mono">{inspector.workflowId}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Claims model</dt>
            <dd className="mt-0.5 break-all font-mono">
              {inspector.model.name}, {inspector.model.effort}
            </dd>
          </div>
        </dl>
      </section>

      {inspector.failure === null ? null : (
        <div
          className="border-destructive/30 bg-destructive/5 mt-3 rounded-lg border p-3"
          role="alert"
        >
          <p className="text-destructive text-sm font-medium">Workflow failed</p>
          <p className="text-muted-foreground mt-1 wrap-break-word text-xs">{inspector.failure}</p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 px-1">
        <h2 className="text-sm font-semibold">Provider activity</h2>
        <span className="text-muted-foreground text-xs">{inspector.activities.length} records</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcedActivity === undefined
          ? `Workflow ${investigationStateLabel(inspector.state)}`
          : `${announcedActivity.actor} ${announcedActivity.operation}: ${activityLifecycleLabel(
              announcedActivity.lifecycle.status,
            )}`}
      </p>
      {inspector.activities.length === 0 ? (
        <div className="mt-2 rounded-lg border border-dashed px-3 py-8 text-center">
          <LoaderCircleIcon
            className={
              "mx-auto size-4 " +
              (inspector.state === "running" || inspector.state === "queued"
                ? "animate-spin motion-reduce:animate-none"
                : "")
            }
          />
          <p className="mt-2 text-sm">
            {inspector.state === "queued"
              ? "Waiting for Workflow to start"
              : "No provider calls recorded"}
          </p>
        </div>
      ) : (
        <ol className="mt-2 space-y-2" aria-label="Investigation provider activity">
          {inspector.activities.map((activity) => (
            <li key={activity.id}>
              <InvestigationActivity activity={activity} now={now} />
            </li>
          ))}
        </ol>
      )}

      <details className="mt-4 rounded-[0.75rem] border bg-card">
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          Durable Workflow steps ({inspector.workflowSteps.length})
        </summary>
        <ol className="border-t px-3 py-2" aria-label="Durable Workflow steps">
          {inspector.workflowSteps.length === 0 ? (
            <li className="text-muted-foreground py-2 text-xs">
              No Workflow step has started yet.
            </li>
          ) : (
            inspector.workflowSteps.map((step) => (
              <li
                key={step.stepNumber + "-" + step.name}
                className="flex gap-2 border-b py-2 last:border-b-0"
              >
                <span
                  className={"mt-1 size-2 shrink-0 rounded-full " + activityStatusDot(step.status)}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block wrap-break-word text-xs">{step.name}</span>
                  <span className="text-muted-foreground mt-0.5 block text-[0.6875rem]">
                    {activityLifecycleLabel(step.status)}
                    {step.completedAt === null
                      ? ""
                      : ", " + formatDuration(step.completedAt - step.startedAt)}
                  </span>
                </span>
              </li>
            ))
          )}
        </ol>
      </details>
    </div>
  );
}

function InvestigationActivity({
  activity,
  now,
}: {
  activity: InvestigationInspector["activities"][number];
  now: number;
}) {
  const status = activity.lifecycle.status;
  const current = status === "running";
  const terminalTime =
    status === "completed"
      ? activity.lifecycle.completedAt
      : status === "failed"
        ? activity.lifecycle.failedAt
        : status === "skipped"
          ? activity.lifecycle.skippedAt
          : now;
  const duration = status === "skipped" ? null : terminalTime - activity.lifecycle.startedAt;

  return (
    <details
      className="group rounded-[0.75rem] border bg-card shadow-[0_2px_8px_color-mix(in_oklch,var(--foreground)_3%,transparent)]"
      open={current || status === "failed" ? true : undefined}
    >
      <summary
        className="cursor-pointer list-none px-3 py-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-current={current ? "step" : undefined}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={"mt-1.5 size-2 shrink-0 rounded-full " + activityStatusDot(status)}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="text-muted-foreground block text-[0.6875rem] font-semibold">
              {activity.actor}
            </span>
            <span className="mt-0.5 block wrap-break-word font-mono text-xs">
              {activity.operation}
            </span>
            <span className="text-muted-foreground mt-1 block text-[0.6875rem]">
              {activityLifecycleLabel(status)}
              {duration === null ? "" : ", " + formatDuration(duration)}
              {status === "skipped" ? "" : ", attempt " + activity.lifecycle.attempt}
            </span>
          </span>
          <ChevronDownIcon
            className="text-muted-foreground mt-1 size-3.5 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </div>
      </summary>
      <div className="border-t px-3 py-3">
        {activity.source.kind === "external" ? (
          <div>
            <p className="text-muted-foreground text-[0.6875rem] font-semibold">Request</p>
            {activity.source.request.url === null ? null : (
              <p className="mt-1 wrap-break-word font-mono text-xs">
                {activity.source.request.method} {activity.source.request.url}
              </p>
            )}
            <pre
              className="bg-muted/60 mt-2 max-w-full overflow-auto rounded-md border p-2 font-mono text-[0.6875rem] leading-5 whitespace-pre-wrap wrap-break-word"
              tabIndex={0}
            >
              {activity.source.request.body}
            </pre>
          </div>
        ) : null}
        {status === "completed" && activity.lifecycle.metrics.length > 0 ? (
          <dl className={activity.source.kind === "external" ? "mt-3 grid gap-2" : "grid gap-2"}>
            {activity.lifecycle.metrics.map((metric) => (
              <div key={metric.label}>
                <dt className="text-muted-foreground text-[0.6875rem]">{metric.label}</dt>
                <dd className="mt-0.5 wrap-break-word whitespace-pre-wrap text-xs">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : status === "failed" ? (
          <p className="text-destructive wrap-break-word text-xs" role="alert">
            {activity.lifecycle.failure}
          </p>
        ) : status === "skipped" ? (
          <p className="text-muted-foreground wrap-break-word text-xs">
            {activity.lifecycle.reason}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">The request is still running.</p>
        )}
      </div>
    </details>
  );
}

function ActivityStatusBadge({ status }: { status: InvestigationInspector["state"] }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs">
      <span className={"size-1.5 rounded-full " + activityStatusDot(status)} aria-hidden="true" />
      {investigationStateLabel(status)}
    </span>
  );
}

function investigationStateLabel(status: InvestigationInspector["state"]) {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function activityLifecycleLabel(
  status:
    | InvestigationInspector["state"]
    | InvestigationInspector["activities"][number]["lifecycle"]["status"]
    | InvestigationInspector["workflowSteps"][number]["status"],
) {
  return status === "queued" ? "Queued" : status.charAt(0).toUpperCase() + status.slice(1);
}

function activityStatusDot(
  status:
    | InvestigationInspector["state"]
    | InvestigationInspector["activities"][number]["lifecycle"]["status"]
    | InvestigationInspector["workflowSteps"][number]["status"],
) {
  switch (status) {
    case "queued":
      return "bg-amber-500";
    case "running":
      return "bg-blue-500 animate-pulse motion-reduce:animate-none";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    case "canceled":
      return "bg-muted-foreground";
    case "skipped":
      return "bg-muted-foreground/60";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function formatDuration(milliseconds: number) {
  const safeMilliseconds = Math.max(0, milliseconds);
  if (safeMilliseconds < 1_000) return Math.round(safeMilliseconds) + " ms";
  const seconds = Math.floor(safeMilliseconds / 1_000);
  if (seconds < 60) return seconds + " s";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? minutes + " min" : minutes + " min " + remainingSeconds + " s";
}

function ProductNavigation({
  loading,
  products,
  selectedProductId,
  onSelect,
}: {
  loading: boolean;
  products: readonly Product[];
  selectedProductId: Product["_id"] | undefined;
  onSelect: (productDomain: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProducts = products.filter(
    (product) =>
      normalizedQuery.length === 0 ||
      product.name.toLocaleLowerCase().includes(normalizedQuery) ||
      product.domain.toLocaleLowerCase().includes(normalizedQuery),
  );

  return (
    <div className="p-2.5">
      <Input
        aria-label="Filter products"
        type="search"
        value={query}
        placeholder="Filter products"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {loading ? (
        <p className="text-muted-foreground px-2 py-8 text-center text-sm" role="status">
          Loading products...
        </p>
      ) : visibleProducts.length === 0 ? (
        <p className="text-muted-foreground px-2 py-8 text-center text-sm">
          {products.length === 0 ? "No products yet." : "No matching products."}
        </p>
      ) : (
        <ul className="mt-2 space-y-1" aria-label="Products">
          {visibleProducts.map((product) => {
            const selected = product._id === selectedProductId;
            return (
              <li key={product._id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-[0.625rem] border border-transparent px-2.5 py-2.5 text-left outline-none transition-colors hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[selected]:border-primary/15 data-[selected]:bg-sidebar-accent data-[selected]:text-sidebar-accent-foreground"
                  data-selected={selected ? "" : undefined}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => onSelect(product.domain)}
                >
                  <ServiceIcon
                    serviceName={product.name}
                    serviceDomain={product.domain}
                    className="size-7 shrink-0 rounded-lg"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{product.name}</span>
                    <span className="text-muted-foreground block truncate font-mono text-[0.6875rem]">
                      {product.domain}
                    </span>
                  </span>
                  <span
                    className={`size-2 shrink-0 rounded-full ${investigationDotClass(product.latestInvestigation?.status)}`}
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {investigationShortLabel(product.latestInvestigation)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProductsMain({
  addOpen,
  loading,
  notice,
  selectedProduct,
  inspector,
  hasProducts,
  selectionMissing,
  syncState,
  onAddCancel,
  onAddFinished,
  onAddSubmittingChange,
}: {
  addOpen: boolean;
  loading: boolean;
  notice: PageNotice;
  selectedProduct: Product | undefined;
  inspector: InvestigationInspector | null | undefined;
  hasProducts: boolean;
  selectionMissing: boolean;
  syncState: RegistrySyncState;
  onAddCancel: () => void;
  onAddFinished: (created: boolean) => void;
  onAddSubmittingChange: (submitting: boolean) => void;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl p-4 @md:p-7 @xl:p-9">
      {addOpen ? (
        <AddProductForm
          onCancel={onAddCancel}
          onAdded={onAddFinished}
          onSubmittingChange={onAddSubmittingChange}
        />
      ) : null}

      {notice ? (
        <p className="text-muted-foreground mt-4 text-sm" role="status">
          {notice.kind === "added" ? "Product added." : "That product was already in the registry."}
        </p>
      ) : null}

      {syncState.kind === "failed" ? (
        <p className="text-destructive mt-4 text-sm" role="alert">
          Existing Scout accounts and Lab experiments could not be synced. Reload to try again.
        </p>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground py-16 text-center text-sm" role="status">
          Loading products...
        </p>
      ) : selectionMissing ? (
        <div className="surface-panel border-dashed px-5 py-16 text-center">
          <p className="text-sm font-medium">Product not found.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Choose another product from the list.
          </p>
        </div>
      ) : selectedProduct === undefined ? (
        <div className="surface-panel border-dashed px-5 py-16 text-center">
          <p className="text-sm font-medium">
            {hasProducts ? "Choose a product." : "No products yet."}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {hasProducts
              ? "Select one from the product list to open its investigation."
              : "Add a product to investigate what it promises customers."}
          </p>
        </div>
      ) : (
        <div className={addOpen || notice || syncState.kind === "failed" ? "mt-6" : undefined}>
          <ProductDetail
            key={selectedProduct._id}
            product={selectedProduct}
            inspector={inspector}
          />
        </div>
      )}
    </main>
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
      className="surface-panel p-5 @md:p-6"
      aria-labelledby="add-product-heading"
    >
      <h2 id="add-product-heading" className="text-xl font-semibold tracking-[-0.025em]">
        Add product
      </h2>
      <form className="mt-5 grid gap-4 @xl:grid-cols-2" onSubmit={(event) => void submit(event)}>
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

        <div className="flex items-center justify-end gap-2 @xl:col-span-2">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
            {submitting ? "Adding" : "Add product"}
          </Button>
        </div>
        {state.kind === "failed" ? (
          <p className="text-destructive text-sm @xl:col-span-2" role="alert">
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function ProductDetail({
  product,
  inspector,
}: {
  product: Product;
  inspector: InvestigationInspector | null | undefined;
}) {
  const [reportOpen, setReportOpen] = useState(true);
  const [requestState, setRequestState] = useState<InvestigationRequestState>({ kind: "idle" });
  const [resetState, setResetState] = useState<ResearchResetState>({ kind: "idle" });
  const latest = product.latestInvestigation;
  const report = latest?.status === "completed" ? latest : product.latestCompletedInvestigation;
  const claimTestStatuses = useQuery(
    api.claimTests.listStatuses,
    report === null ? "skip" : { domain: product.domain },
  );
  const resetAvailable =
    (latest !== null || report !== null) &&
    latest?.status !== "queued" &&
    latest?.status !== "running";

  return (
    <article>
      <header>
        <div className="flex flex-col gap-3 @xl:flex-row @xl:items-start @xl:justify-between @xl:gap-6">
          <div className="flex min-w-0 items-start gap-3">
            <ServiceIcon
              serviceName={product.name}
              serviceDomain={product.domain}
              className="mt-0.5 size-10 rounded-[0.625rem]"
            />
            <div className="min-w-0">
              <h2 className="wrap-break-word text-xl font-semibold tracking-[-0.03em] @md:text-2xl">
                {product.name}
              </h2>
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
          <InvestigationStatus
            investigation={latest}
            currentOperation={currentInvestigationOperation(inspector)}
          />
        </div>
      </header>

      <div className="mt-5 grid gap-4 text-sm @2xl:grid-cols-[minmax(0,1fr)_auto] @2xl:items-end">
        <dl>
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">Scout access</dt>
            <dd className="mt-1">
              <ScoutAccess access={product.scoutAccess} />
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2 @2xl:justify-end">
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
          {resetAvailable && resetState.kind === "idle" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setResetState({ kind: "confirming" })}
            >
              <RotateCcwIcon />
              Reset research
            </Button>
          ) : null}
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

      <ResearchReset
        productId={product._id}
        productName={product.name}
        state={resetState}
        onStateChange={setResetState}
      />

      {report ? (
        <Collapsible open={reportOpen} onOpenChange={setReportOpen}>
          <CollapsibleContent id={`product-investigation-${product._id}`}>
            <InvestigationReport
              claimTestStatuses={claimTestStatuses}
              investigation={report}
              productDomain={product.domain}
            />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </article>
  );
}

function ResearchReset({
  productId,
  productName,
  state,
  onStateChange,
}: {
  productId: Product["_id"];
  productName: string;
  state: ResearchResetState;
  onStateChange: (state: ResearchResetState) => void;
}) {
  const resetResearch = useMutation(api.products.resetResearch);

  if (state.kind === "idle") {
    return null;
  }
  if (state.kind === "done") {
    return (
      <p className="text-muted-foreground mt-4 text-sm" role="status">
        Research reset. You can investigate {productName} again when ready.
      </p>
    );
  }

  const submitting = state.kind === "submitting";
  const reset = async () => {
    if (submitting) {
      return;
    }
    onStateChange({ kind: "submitting" });
    try {
      await resetResearch({ productId });
      onStateChange({ kind: "done" });
    } catch (error) {
      onStateChange({ kind: "failed", message: resetResearchError(error) });
    }
  };

  return (
    <section
      className="mt-4 rounded-[0.75rem] border bg-muted/45 px-4 py-4"
      aria-label="Reset research"
    >
      <p className="text-sm font-medium">Reset research for {productName}?</p>
      <p className="text-muted-foreground mt-1 text-sm">
        This hides the current report and returns the product to Not investigated. The underlying
        run history is kept.
      </p>
      {state.kind === "failed" ? (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={submitting}
          onClick={() => onStateChange({ kind: "idle" })}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={submitting}
          onClick={() => void reset()}
        >
          {submitting ? <LoaderCircleIcon className="animate-spin" /> : <RotateCcwIcon />}
          {submitting ? "Resetting" : "Reset research"}
        </Button>
      </div>
    </section>
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
              {`, ${accessEvidenceLabel(scout.authenticationEvidence)}`}
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}

function currentInvestigationOperation(
  inspector: InvestigationInspector | null | undefined,
): string | null {
  if (inspector === undefined || inspector === null) return null;
  for (let index = inspector.activities.length - 1; index >= 0; index -= 1) {
    const activity = inspector.activities[index];
    if (activity?.lifecycle.status === "running") {
      return `${activity.actor} ${activity.operation}`;
    }
  }
  for (let index = inspector.workflowSteps.length - 1; index >= 0; index -= 1) {
    const step = inspector.workflowSteps[index];
    if (step?.status === "running") return step.name;
  }
  return null;
}

function InvestigationStatus({
  investigation,
  currentOperation,
}: {
  investigation: Investigation | null;
  currentOperation: string | null;
}) {
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
          {...(currentOperation === null ? {} : { note: currentOperation })}
          detail={investigation.startedAt}
          credits={investigation.creditsUsed}
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
  note,
  detail,
  credits,
}: {
  dotClass: string;
  label: string;
  note?: string;
  detail: number;
  credits?: number | null;
}) {
  return (
    <span
      className="inline-flex min-w-0 items-start gap-2 text-left text-sm @xl:max-w-[58%] @xl:shrink-0 @xl:text-right"
      role="status"
    >
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {note ? (
          <span className="text-muted-foreground block wrap-break-word text-xs">{note}</span>
        ) : null}
        <span className="text-muted-foreground block wrap-break-word text-xs">
          {investigationDate.format(detail)}
          {credits === undefined || credits === null
            ? null
            : `, ${creditCount.format(credits)} Firecrawl credits`}
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
  const { setMobilePane, toggleRightPane } = useSidebarActions();
  const { isMobile, rightDesktopOpen } = useSidebarLayoutPresentation();
  const submitting = state.kind === "submitting";

  const showActivity = () => {
    if (isMobile) {
      setMobilePane("right");
    } else if (!rightDesktopOpen) {
      toggleRightPane();
    }
  };

  if (investigation?.status === "queued" || investigation?.status === "running") {
    return (
      <Button type="button" size="sm" disabled>
        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
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
    showActivity();
    try {
      await startInvestigation({ productId });
      onStateChange({ kind: "idle" });
    } catch {
      onStateChange({
        kind: "failed",
        message: "Could not start the investigation. Try again.",
      });
      if (isMobile) setMobilePane("main");
    }
  };

  return (
    <Button type="button" size="sm" disabled={submitting} onClick={() => void request()}>
      {submitting ? (
        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
      ) : investigation === null ? (
        <SearchIcon />
      ) : (
        <RefreshCwIcon />
      )}
      {submitting ? "Starting" : actionLabel}
    </Button>
  );
}

function InvestigationReport({
  claimTestStatuses,
  investigation,
  productDomain,
}: {
  claimTestStatuses: ClaimTestStatuses | undefined;
  investigation: CompletedInvestigation;
  productDomain: string;
}) {
  const claimTestStateByKey = new Map(
    claimTestStatuses?.map(({ claimKey, state }) => [claimKey, state]),
  );

  return (
    <section className="mt-6 border-t pt-6" aria-label="Investigation result">
      <p className="text-muted-foreground mb-4 text-xs">
        {investigation.result.claims.length} unverified claims,{" "}
        {creditCount.format(investigation.creditsUsed)} Firecrawl credits,{" "}
        {investigationDate.format(investigation.completedAt)}
      </p>

      {investigation.result.claims.length === 0 ? (
        <EmptyReportValue />
      ) : (
        <ul className="surface-panel divide-y overflow-hidden" aria-label="Claims">
          {investigation.result.claims.map((claim) => (
            <li key={claim.claimKey}>
              <Link
                to="/products/$domain/claims/$claimKey"
                params={{ domain: productDomain, claimKey: claim.claimKey }}
                className="group flex items-start gap-3 p-4 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40 @md:p-5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block wrap-break-word text-sm font-medium leading-6">
                    {claim.claim}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground font-mono text-[0.625rem] font-medium">
                      {claim.category}
                    </span>
                    <ClaimTestStatus
                      state={
                        claimTestStatuses === undefined
                          ? "loading"
                          : (claimTestStateByKey.get(claim.claimKey) ?? "untested")
                      }
                    />
                  </span>
                </span>
                <ArrowRightIcon
                  className="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-6 border-t pt-5">
        <summary className="text-muted-foreground cursor-pointer select-none text-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          Research details
        </summary>
        <div className="mt-6 grid gap-6 @2xl:grid-cols-2">
          <ReportSection title="Summary" className="@2xl:col-span-2">
            <p className="wrap-break-word text-sm leading-6">{investigation.result.summary}</p>
          </ReportSection>

          <ReportSection title="Tensions" className="@2xl:col-span-2">
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
            className="@2xl:col-span-2"
          >
            {investigation.result.sources.length === 0 ? (
              <EmptyReportValue />
            ) : (
              <ul className="grid gap-2 @2xl:grid-cols-2">
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
      </details>
    </section>
  );
}

function ClaimTestStatus({ state }: { state: ClaimTestListState }) {
  const label = {
    failed: "Test failed",
    loading: "Checking",
    needs_retest: "Needs retest",
    tested: "Tested",
    testing: "Testing",
    untested: "Untested",
  }[state];
  const className = {
    failed: "border-destructive/30 bg-destructive/10 text-destructive",
    loading: "border-border bg-muted/70 text-muted-foreground",
    needs_retest:
      "border-amber-600/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:text-amber-300",
    tested:
      "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300",
    testing:
      "border-blue-600/30 bg-blue-500/10 text-blue-700 dark:border-blue-400/30 dark:text-blue-300",
    untested: "border-border bg-muted text-muted-foreground",
  }[state];

  return (
    <span
      className={`inline-flex rounded-md border px-2 py-1 text-[0.6875rem] leading-none font-semibold ${className}`}
      aria-live="polite"
    >
      {label}
    </span>
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
      <h3 className="mb-2 text-sm font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
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

function resetResearchError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Wait for the active investigation to finish")) {
    return "Wait for the active investigation to finish before resetting research.";
  }
  if (message.includes("Product not found")) {
    return "This product no longer exists.";
  }
  return "Could not reset the research. Try again.";
}

function reportButtonLabel(investigation: Investigation | null) {
  return investigation?.status === "completed" ? "Show investigation" : "Show last investigation";
}

function investigationDotClass(status: Investigation["status"] | undefined) {
  switch (status) {
    case undefined:
      return "bg-muted-foreground";
    case "queued":
      return "bg-amber-500";
    case "running":
      return "bg-blue-500";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function investigationShortLabel(investigation: Investigation | null) {
  if (investigation === null) {
    return "Not investigated";
  }

  switch (investigation.status) {
    case "queued":
      return "Investigation queued";
    case "running":
      return "Investigation running";
    case "completed":
      return "Investigated";
    case "failed":
      return "Investigation failed";
    default: {
      const exhaustive: never = investigation;
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
