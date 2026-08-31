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
  ArrowRightIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
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
import { Input } from "#components/ui/input";
import { Textarea } from "#components/ui/textarea";

type Product = FunctionReturnType<typeof api.products.list>[number];
type ProductTask = FunctionReturnType<typeof api.tasks.listForProduct>[number];
type Investigation = NonNullable<Product["latestInvestigation"]>;
type CompletedInvestigation = NonNullable<Product["latestCompletedInvestigation"]>;
type InvestigationInspector = NonNullable<
  FunctionReturnType<typeof api.productsInvestigationInspector.get>
>;

type SubmitState = { kind: "idle" | "submitting" } | { kind: "failed"; message: string };
type ResearchResetState =
  | { kind: "idle" | "confirming" | "submitting" | "done" }
  | { kind: "failed"; message: string };
type PageNotice = { kind: "added" | "existing" } | null;

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const PRODUCT_RESIZE_HANDLE_LABELS = {
  left: "Resize product list",
  right: "Resize product research activity",
} satisfies SidebarLayoutResizeHandleLabels;

const formatResizeHandleValueText: SidebarLayoutResizeHandleValueTextFormatter = ({ widthPx }) =>
  `${widthPx} pixels wide`;

export function ProductsWorkspace({ domain }: { domain?: string }) {
  const navigate = useNavigate();
  const products = useQuery(api.products.list, {});
  const { setMobilePane } = useSidebarActions();
  const [addOpen, setAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [notice, setNotice] = useState<PageNotice>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  const loading = products === undefined;
  const loadedProducts = products ?? [];
  const selectedProduct = loadedProducts.find((product) => product.domain === domain);
  const investigationId = selectedProduct?.latestInvestigation?._id;
  const inspector = useQuery(
    api.productsInvestigationInspector.get,
    investigationId === undefined ? "skip" : { investigationId },
  );

  useEffect(() => {
    const firstProduct = loadedProducts[0];
    if (domain !== undefined || loading || firstProduct === undefined) return;
    void navigate({
      to: "/products/$domain",
      params: { domain: firstProduct.domain },
      replace: true,
    });
  }, [domain, loadedProducts, loading, navigate]);

  const closeAdd = () => {
    if (addSubmitting) return;
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
      <SidebarLayout
        addressChrome={
          <ProductsChrome
            activityState={inspector?.state}
            addButton={addButton}
            addOpen={addOpen}
            addSubmitting={addSubmitting}
            loading={loading}
            productCount={loadedProducts.length}
            onToggleAdd={() => {
              setNotice(null);
              setAddOpen((open) => !open);
              setMobilePane("main");
            }}
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
                onSelect={() => requestAnimationFrame(() => setMobilePane("main"))}
              />
            }
            footer={
              <div className="text-muted-foreground flex h-full items-center px-3 text-xs">
                {loading
                  ? "Loading"
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
                hasProducts={loadedProducts.length > 0}
                loading={loading}
                notice={notice}
                selectedProduct={selectedProduct}
                selectionMissing={domain !== undefined && !loading && selectedProduct === undefined}
                onAddCancel={closeAdd}
                onAddFinished={finishAdd}
                onAddSubmittingChange={setAddSubmitting}
              />
            }
            scrollRestorationId="product-workspace"
          />
        }
        right={
          <PaneFrame
            content={
              <ResearchActivityPane
                inspector={inspector}
                investigationId={investigationId}
                productName={selectedProduct?.name}
              />
            }
            footer={<ResearchActivityFooter inspector={inspector} />}
            header={<ResearchActivityHeader inspector={inspector} />}
            scrollRestorationId="product-research-activity"
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

  return (
    <div className="flex h-12 min-w-0 items-center gap-2 px-2 sm:px-4">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={productsShown ? "Hide products" : "Show products"}
        aria-pressed={productsShown}
        onClick={() =>
          isMobile ? setMobilePane(productsShown ? "main" : "left") : toggleLeftPane()
        }
      >
        <PanelLeftIcon />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">Products</h1>
        <p className="text-muted-foreground hidden truncate text-xs sm:block">
          Tasks and product research
        </p>
      </div>
      <span className="sr-only" aria-live="polite">
        {loading ? "Loading products" : `${productCount} products`}
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={activityShown ? "Hide research activity" : "Show research activity"}
        aria-pressed={activityShown}
        onClick={() =>
          isMobile ? setMobilePane(activityShown ? "main" : "right") : toggleRightPane()
        }
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

function ProductNavigation({
  loading,
  products,
  selectedProductId,
  onSelect,
}: {
  loading: boolean;
  products: readonly Product[];
  selectedProductId: Product["_id"] | undefined;
  onSelect: () => void;
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
          Loading products
        </p>
      ) : visibleProducts.length === 0 ? (
        <p className="text-muted-foreground px-2 py-8 text-center text-sm">
          {products.length === 0 ? "No products" : "No matches"}
        </p>
      ) : (
        <ul className="mt-2 space-y-1" aria-label="Products">
          {visibleProducts.map((product) => {
            const selected = product._id === selectedProductId;
            return (
              <li key={product._id}>
                <Link
                  to="/products/$domain"
                  params={{ domain: product.domain }}
                  className="flex w-full items-center gap-2.5 rounded-[0.625rem] border border-transparent px-2.5 py-2.5 text-left outline-none transition-colors hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[selected]:border-primary/15 data-[selected]:bg-sidebar-accent"
                  data-selected={selected ? "" : undefined}
                  aria-current={selected ? "page" : undefined}
                  onClick={onSelect}
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
                    className={`size-2 shrink-0 rounded-full ${researchDot(product.latestInvestigation?.status)}`}
                    aria-hidden="true"
                  />
                </Link>
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
  hasProducts,
  loading,
  notice,
  selectedProduct,
  selectionMissing,
  onAddCancel,
  onAddFinished,
  onAddSubmittingChange,
}: {
  addOpen: boolean;
  hasProducts: boolean;
  loading: boolean;
  notice: PageNotice;
  selectedProduct: Product | undefined;
  selectionMissing: boolean;
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
        <p className="text-muted-foreground mt-3 text-sm" role="status">
          {notice.kind === "added" ? "Product added" : "Product already exists"}
        </p>
      ) : null}
      {loading ? (
        <p className="text-muted-foreground py-16 text-center text-sm" role="status">
          Loading products
        </p>
      ) : selectionMissing ? (
        <EmptyPanel title="Product not found" body="Choose another product from the registry." />
      ) : selectedProduct === undefined ? (
        <EmptyPanel
          title={hasProducts ? "Choose a product" : "No products"}
          body={hasProducts ? "Select a product from the registry." : "Add a product to begin."}
        />
      ) : (
        <div className={addOpen || notice ? "mt-6" : undefined}>
          <ProductDetail key={selectedProduct._id} product={selectedProduct} />
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
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const submitting = state.kind === "submitting";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (!url.trim()) {
      setState({ kind: "failed", message: "Enter a product URL or domain." });
      return;
    }
    setState({ kind: "submitting" });
    onSubmittingChange(true);
    try {
      const result = await createProduct({
        url: url.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      onAdded(result.created);
    } catch (error) {
      onSubmittingChange(false);
      setState({ kind: "failed", message: actionError(error, "Could not add product") });
    }
  };

  return (
    <section
      id="add-product-panel"
      className="surface-panel p-5"
      aria-labelledby="add-product-heading"
    >
      <h2 id="add-product-heading" className="text-lg font-semibold">
        Add product
      </h2>
      <form className="mt-4 grid gap-4 @xl:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <Field label="URL or domain" htmlFor="product-url">
          <Input
            id="product-url"
            value={url}
            autoFocus
            required
            disabled={submitting}
            placeholder="cloudflare.com"
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
        </Field>
        <Field label="Name" htmlFor="product-name" hint="Optional">
          <Input
            id="product-name"
            value={name}
            disabled={submitting}
            placeholder="Derived from domain"
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        {state.kind === "failed" ? (
          <p className="text-destructive text-sm @xl:col-span-2" role="alert">
            {state.message}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 @xl:col-span-2">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
            {submitting ? "Adding" : "Add product"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function ProductDetail({ product }: { product: Product }) {
  const tasks = useQuery(api.tasks.listForProduct, { domain: product.domain });
  const startResearch = useMutation(api.products.startInvestigation);
  const resetResearch = useMutation(api.products.resetResearch);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [researchState, setResearchState] = useState<SubmitState>({ kind: "idle" });
  const [resetState, setResetState] = useState<ResearchResetState>({ kind: "idle" });
  const latest = product.latestInvestigation;
  const report = latest?.status === "completed" ? latest : product.latestCompletedInvestigation;
  const researchActive = latest?.status === "queued" || latest?.status === "running";

  const runResearch = async () => {
    if (researchActive || researchState.kind === "submitting") return;
    setResearchState({ kind: "submitting" });
    try {
      await startResearch({ productId: product._id });
      setResearchState({ kind: "idle" });
    } catch (error) {
      setResearchState({ kind: "failed", message: actionError(error, "Could not start research") });
    }
  };

  const confirmReset = async () => {
    setResetState({ kind: "submitting" });
    try {
      await resetResearch({ productId: product._id });
      setResetState({ kind: "done" });
    } catch (error) {
      setResetState({ kind: "failed", message: actionError(error, "Could not clear research") });
    }
  };

  return (
    <article>
      <header className="flex flex-col gap-4 border-b pb-6 @xl:flex-row @xl:items-start @xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ServiceIcon
            serviceName={product.name}
            serviceDomain={product.domain}
            className="size-10 shrink-0 rounded-[0.625rem]"
          />
          <div className="min-w-0">
            <h2 className="wrap-break-word text-2xl font-semibold tracking-[-0.03em]">
              {product.name}
            </h2>
            <a
              href={product.primaryUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground mt-1 inline-flex items-center gap-1 font-mono text-xs hover:text-foreground"
            >
              {product.domain}
              <ExternalLinkIcon className="size-3" aria-hidden="true" />
            </a>
          </div>
        </div>
        <ScoutAccess access={product.scoutAccess} />
      </header>

      <section className="py-6" aria-labelledby="tasks-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="tasks-heading" className="text-base font-semibold">
              Tasks
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">Free-form work for a Scout</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={taskFormOpen}
            onClick={() => setTaskFormOpen((open) => !open)}
          >
            {taskFormOpen ? <XIcon /> : <PlusIcon />}
            {taskFormOpen ? "Close" : "Add task"}
          </Button>
        </div>
        {taskFormOpen ? (
          <AddTaskForm product={product} onCancel={() => setTaskFormOpen(false)} />
        ) : null}
        {tasks === undefined ? (
          <p className="text-muted-foreground py-8 text-sm" role="status">
            Loading tasks
          </p>
        ) : tasks.length === 0 ? (
          <div className="mt-4 border-y py-8 text-center">
            <p className="text-sm font-medium">No tasks</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Add an instruction you want a Scout to carry out.
            </p>
          </div>
        ) : (
          <ul className="surface-panel mt-4 divide-y overflow-hidden" aria-label="Product tasks">
            {tasks.map((task) => (
              <TaskRow key={task.taskId} domain={product.domain} task={task} />
            ))}
          </ul>
        )}
      </section>

      <section className="border-t pt-6" aria-labelledby="research-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="research-heading" className="text-base font-semibold">
              Product research
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Optional context; it does not define Tasks
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={researchActive || researchState.kind === "submitting"}
              onClick={() => void runResearch()}
            >
              {researchActive || researchState.kind === "submitting" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <RefreshCwIcon />
              )}
              {researchActive ? "Researching" : report ? "Research again" : "Research product"}
            </Button>
            {(latest !== null || report !== null) &&
            !researchActive &&
            resetState.kind === "idle" ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setResetState({ kind: "confirming" })}
              >
                <RotateCcwIcon />
                Clear research
              </Button>
            ) : null}
          </div>
        </div>

        {resetState.kind === "confirming" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-y py-3">
            <p className="min-w-0 flex-1 text-sm">
              Clear the saved research report for {product.name}?
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setResetState({ kind: "idle" })}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => void confirmReset()}
            >
              Clear
            </Button>
          </div>
        ) : null}
        {resetState.kind === "failed" ? <ErrorText>{resetState.message}</ErrorText> : null}
        {researchState.kind === "failed" ? <ErrorText>{researchState.message}</ErrorText> : null}
        {latest?.status === "failed" ? (
          <div className="mt-4 border-y border-destructive/30 py-3">
            <p className="text-destructive text-sm font-medium">Research failed</p>
            <p className="text-muted-foreground mt-1 wrap-break-word text-xs">{latest.failure}</p>
          </div>
        ) : null}
        {report ? (
          <ResearchReport investigation={report} />
        ) : (
          <p className="text-muted-foreground py-8 text-sm">No research report</p>
        )}
      </section>
    </article>
  );
}

function AddTaskForm({ product, onCancel }: { product: Product; onCancel: () => void }) {
  const navigate = useNavigate();
  const createTask = useMutation(api.tasks.create);
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const submitting = state.kind === "submitting";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const value = instruction.trim();
    if (!value) {
      setState({ kind: "failed", message: "Enter an instruction." });
      return;
    }
    setState({ kind: "submitting" });
    try {
      const result = await createTask({ productId: product._id, instruction: value });
      await navigate({
        to: "/products/$domain/tasks/$taskId",
        params: { domain: product.domain, taskId: result.taskId },
      });
    } catch (error) {
      setState({ kind: "failed", message: actionError(error, "Could not add task") });
    }
  };

  return (
    <form className="mt-4 border-y py-4" onSubmit={(event) => void submit(event)}>
      <Field label="Instruction" htmlFor="task-instruction">
        <Textarea
          id="task-instruction"
          value={instruction}
          rows={4}
          autoFocus
          required
          maxLength={16_000}
          disabled={submitting}
          placeholder={`Use the available Scout resources to work on ${product.name}…`}
          onChange={(event) => setInstruction(event.currentTarget.value)}
        />
      </Field>
      {state.kind === "failed" ? <ErrorText>{state.message}</ErrorText> : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
          {submitting ? "Adding" : "Add task"}
        </Button>
      </div>
    </form>
  );
}

function TaskRow({ domain, task }: { domain: string; task: ProductTask }) {
  return (
    <li>
      <Link
        to="/products/$domain/tasks/$taskId"
        params={{ domain, taskId: task.taskId }}
        className="group flex items-start gap-3 p-4 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40 @md:p-5"
      >
        <span className="min-w-0 flex-1">
          <span className="block whitespace-pre-wrap text-sm font-medium leading-6">
            {task.instruction}
          </span>
          <span className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
            <TaskState state={task.latestAttempt?.state.kind ?? "not_started"} />
            <span>
              {task.attemptCount} {task.attemptCount === 1 ? "attempt" : "attempts"}
            </span>
            {task.latestAttempt ? <span>{task.latestAttempt.scoutName}</span> : null}
          </span>
        </span>
        <ArrowRightIcon
          className="text-muted-foreground mt-1 size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

function TaskState({ state }: { state: "not_started" | "pending" | "completed" | "failed" }) {
  const values = {
    not_started: ["Not started", "bg-muted-foreground"],
    pending: ["Active", "bg-blue-500"],
    completed: ["Completed", "bg-emerald-500"],
    failed: ["Failed", "bg-destructive"],
  } as const;
  const [label, dot] = values[state];
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function ResearchReport({ investigation }: { investigation: CompletedInvestigation }) {
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{investigation.result.claims.length} research leads</span>
        <span>{number.format(investigation.creditsUsed)} Firecrawl credits</span>
        <span>{dateTime.format(investigation.completedAt)}</span>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{investigation.result.summary}</p>
      {investigation.result.claims.length > 0 ? (
        <div className="mt-5">
          <h4 className="text-sm font-semibold">Research leads</h4>
          <ul className="mt-2 divide-y border-y" aria-label="Research leads">
            {investigation.result.claims.map((claim, index) => (
              <li key={`${index}:${claim.sourceUrl}`} className="py-3">
                <p className="text-sm leading-6">{claim.claim}</p>
                <p className="text-muted-foreground mt-1 font-mono text-[0.6875rem]">
                  {claim.category}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="mt-5 border-t pt-4">
        <summary className="text-muted-foreground cursor-pointer text-sm hover:text-foreground">
          Research details
        </summary>
        <div className="mt-5 grid gap-6 @xl:grid-cols-2">
          <ReportSection title="Audience">
            <StringList values={investigation.result.audiences} />
          </ReportSection>
          <ReportSection title="Access">
            <AccessSummary access={investigation.result.access} />
          </ReportSection>
          <ReportSection title="Dependencies">
            {investigation.result.dependencies.length === 0 ? (
              <EmptyValue />
            ) : (
              <ul className="space-y-3 text-sm">
                {investigation.result.dependencies.map((dependency) => (
                  <li key={`${dependency.name}:${dependency.sourceUrl}`}>
                    <p className="font-medium">{dependency.name}</p>
                    <p className="text-muted-foreground mt-0.5">{dependency.relationship}</p>
                  </li>
                ))}
              </ul>
            )}
          </ReportSection>
          <ReportSection title="Unknowns">
            <StringList values={investigation.result.unknowns} />
          </ReportSection>
          <ReportSection
            title={`Sources (${investigation.result.sources.length})`}
            className="@xl:col-span-2"
          >
            {investigation.result.sources.length === 0 ? (
              <EmptyValue />
            ) : (
              <ul className="grid gap-2 @xl:grid-cols-2">
                {investigation.result.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      className="text-muted-foreground text-sm hover:text-foreground hover:underline"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.title || source.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </ReportSection>
        </div>
      </details>
    </div>
  );
}

function ScoutAccess({ access }: { access: Product["scoutAccess"] }) {
  if (access.length === 0)
    return <span className="text-muted-foreground text-xs">No Scout account</span>;
  return (
    <div className="text-right text-xs">
      {access.map((item) => (
        <p key={item.scoutId} className="flex items-center justify-end gap-1.5">
          <span
            className={`size-1.5 rounded-full ${accessDot(item.authenticationEvidence)}`}
            aria-hidden="true"
          />
          {item.displayName} · {item.accountCount}{" "}
          {item.accountCount === 1 ? "account" : "accounts"}
        </p>
      ))}
    </div>
  );
}

function ResearchActivityHeader({
  inspector,
}: {
  inspector: InvestigationInspector | null | undefined;
}) {
  return (
    <div className="flex h-full items-center justify-between gap-3 px-3">
      <span className="truncate text-sm font-semibold">Research activity</span>
      <span className="text-muted-foreground text-xs">
        {inspector ? stateLabel(inspector.state) : ""}
      </span>
    </div>
  );
}

function ResearchActivityFooter({
  inspector,
}: {
  inspector: InvestigationInspector | null | undefined;
}) {
  if (!inspector) return <div className="h-full" />;
  const startedAt = inspector.startedAt ?? inspector.requestedAt;
  const duration = inspector.finishedAt === null ? null : inspector.finishedAt - startedAt;
  return (
    <div className="text-muted-foreground flex h-full items-center justify-between gap-3 px-3 text-xs">
      <span>
        {number.format(inspector.firecrawlCredits.used)} / {inspector.firecrawlCredits.maximum}{" "}
        credits
      </span>
      {duration === null ? null : <span>{formatDuration(duration)}</span>}
    </div>
  );
}

function ResearchActivityPane({
  inspector,
  investigationId,
  productName,
}: {
  inspector: InvestigationInspector | null | undefined;
  investigationId: Investigation["_id"] | undefined;
  productName: string | undefined;
}) {
  if (investigationId === undefined) return <PaneMessage>No research run</PaneMessage>;
  if (inspector === undefined) return <PaneMessage>Loading research activity</PaneMessage>;
  if (inspector === null) return <PaneMessage>Research activity unavailable</PaneMessage>;
  return (
    <div className="p-3">
      <section className="border-b pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{productName ?? "Product"} research</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {dateTime.format(inspector.requestedAt)}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
            <span
              className={`size-1.5 rounded-full ${activityDot(inspector.state)}`}
              aria-hidden="true"
            />
            {stateLabel(inspector.state)}
          </span>
        </div>
        <dl className="mt-3 grid gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Workflow</dt>
            <dd className="mt-0.5 break-all font-mono">{String(inspector.workflowId)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="mt-0.5 break-all font-mono">
              {inspector.model.name}, {inspector.model.effort}
            </dd>
          </div>
        </dl>
      </section>
      {inspector.failure ? <ErrorText>{inspector.failure}</ErrorText> : null}
      <div className="mt-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Provider calls</h2>
        <span className="text-muted-foreground text-xs">{inspector.activities.length}</span>
      </div>
      {inspector.activities.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">No provider calls</p>
      ) : (
        <ol className="mt-2 divide-y border-y">
          {inspector.activities.map((activity) => (
            <li key={activity.id}>
              <details
                open={
                  activity.lifecycle.status === "running" || activity.lifecycle.status === "failed"
                }
              >
                <summary className="cursor-pointer list-none py-3 text-xs">
                  <span className="flex items-start gap-2">
                    <span
                      className={`mt-1 size-1.5 shrink-0 rounded-full ${activityDot(activity.lifecycle.status)}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-muted-foreground block text-[0.6875rem] font-semibold">
                        {activity.actor}
                      </span>
                      <span className="mt-0.5 block wrap-break-word font-mono">
                        {activity.operation}
                      </span>
                      <span className="text-muted-foreground mt-1 block text-[0.6875rem]">
                        {stateLabel(activity.lifecycle.status)}
                      </span>
                    </span>
                    <ChevronDownIcon
                      className="text-muted-foreground size-3.5"
                      aria-hidden="true"
                    />
                  </span>
                </summary>
                <div className="border-t pb-3 pt-3 text-xs">
                  {activity.source.kind === "external" ? (
                    <>
                      {activity.source.request.url ? (
                        <p className="wrap-break-word font-mono">
                          {activity.source.request.method} {activity.source.request.url}
                        </p>
                      ) : null}
                      <pre className="bg-muted/60 mt-2 max-w-full overflow-auto rounded-md border p-2 font-mono text-[0.6875rem] leading-5 whitespace-pre-wrap wrap-break-word">
                        {activity.source.request.body}
                      </pre>
                    </>
                  ) : null}
                  {activity.lifecycle.status === "failed" ? (
                    <p className="text-destructive wrap-break-word">{activity.lifecycle.failure}</p>
                  ) : activity.lifecycle.status === "completed" &&
                    activity.lifecycle.metrics.length > 0 ? (
                    <dl className="grid gap-2">
                      {activity.lifecycle.metrics.map((metric) => (
                        <div key={metric.label}>
                          <dt className="text-muted-foreground">{metric.label}</dt>
                          <dd className="mt-0.5 whitespace-pre-wrap">{metric.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
      <details className="mt-4 border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium">
          Workflow steps ({inspector.workflowSteps.length})
        </summary>
        <ol className="mt-2 divide-y">
          {inspector.workflowSteps.map((step) => (
            <li key={`${step.stepNumber}:${step.name}`} className="flex gap-2 py-2 text-xs">
              <span
                className={`mt-1 size-1.5 rounded-full ${activityDot(step.status)}`}
                aria-hidden="true"
              />
              <span>{step.name}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
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
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

function StringList({ values }: { values: readonly string[] }) {
  return values.length === 0 ? (
    <EmptyValue />
  ) : (
    <ul className="list-disc space-y-1.5 pl-4 text-sm">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

function EmptyValue() {
  return <p className="text-muted-foreground text-sm">None</p>;
}

function AccessSummary({ access }: { access: CompletedInvestigation["result"]["access"] }) {
  return (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">Signup</dt>
        <dd>{access.signupState.replaceAll("_", " ")}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">Free entry</dt>
        <dd>{access.freeEntry}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">Payment method</dt>
        <dd>{access.paymentMethodRequired}</dd>
      </div>
    </dl>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {hint ? <span className="text-muted-foreground ml-2 text-xs">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="surface-panel mt-4 border-dashed px-5 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm">{body}</p>
    </div>
  );
}

function PaneMessage({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground p-5 text-sm" role="status">
      {children}
    </p>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="text-destructive mt-3 wrap-break-word text-sm" role="alert">
      {children}
    </p>
  );
}

function actionError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const marker = "Uncaught Error: ";
  const detail = message.includes(marker)
    ? message.slice(message.indexOf(marker) + marker.length).split("\n")[0]
    : "";
  return detail || fallback;
}

function researchDot(status: Investigation["status"] | undefined) {
  return status === "completed"
    ? "bg-emerald-500"
    : status === "failed"
      ? "bg-destructive"
      : status === "running" || status === "queued"
        ? "bg-blue-500"
        : "bg-muted-foreground";
}

function accessDot(state: Product["scoutAccess"][number]["authenticationEvidence"]) {
  return state === "succeeded"
    ? "bg-emerald-500"
    : state === "failed"
      ? "bg-destructive"
      : "bg-muted-foreground";
}

function activityDot(status: string) {
  return status === "completed"
    ? "bg-emerald-500"
    : status === "failed"
      ? "bg-destructive"
      : status === "running"
        ? "bg-blue-500 animate-pulse"
        : status === "queued"
          ? "bg-amber-500"
          : "bg-muted-foreground";
}

function stateLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
