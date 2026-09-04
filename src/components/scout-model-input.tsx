import { useAction, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ChevronRightIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#components/ui/collapsible";

type ModelCallSummary = FunctionReturnType<typeof api.scout.modelCalls.listForTurn>[number];
type ModelCallContext = NonNullable<FunctionReturnType<typeof api.scout.modelCalls.getContext>>;

const jsonValueSchema = z.json();
const messageLabelSchema = z.object({ role: z.string() });
const toolLabelSchema = z.object({ name: z.string() });
const modelInputSnapshotSchema = z.object({
  version: z.literal(1),
  instructions: z.json(),
  messages: z.array(z.json()),
  tools: z.union([z.array(z.json()), z.null()]),
  settings: z.record(z.string(), z.json()),
});

type ModelInputSnapshot = z.output<typeof modelInputSnapshotSchema>;

type ModelInputLoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "failed" }
  | { kind: "ready"; context: ModelCallContext; snapshot: ModelInputSnapshot }
  | { kind: "unsupported" };

export function ScoutModelCalls({
  turnId,
  onSelect,
}: {
  turnId: FunctionArgs<typeof api.scout.modelCalls.listForTurn>["turnId"];
  onSelect: (modelCallId: ModelCallSummary["modelCallId"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const calls = useQuery(api.scout.modelCalls.listForTurn, open ? { turnId } : "skip");

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border bg-muted/20 text-xs"
    >
      <CollapsibleTrigger className="group/model-calls flex w-full items-center gap-2 px-3 py-2 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/model-calls:rotate-90" />
        Model calls
        {calls ? (
          <span className="text-muted-foreground ml-auto font-normal">{calls.length}</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t p-1.5">
          {!calls ? (
            <p className="text-muted-foreground px-2 py-1.5">Loading...</p>
          ) : calls.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5">No calls captured.</p>
          ) : (
            <ol className="grid gap-1">
              {calls.map((call) => (
                <li key={call.modelCallId}>
                  <button
                    type="button"
                    className="hover:bg-muted focus-visible:ring-ring flex w-full items-start gap-3 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2"
                    onClick={() => onSelect(call.modelCallId)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="font-medium">Call {call.sequence}</span>
                        <span className="text-muted-foreground truncate">
                          {call.provider} · {call.modelId}
                        </span>
                      </span>
                      <span className="text-muted-foreground mt-0.5 block">
                        {formatCallSize(call)}
                        {call.compactedBrowserSnapshotCount > 0
                          ? ` · ${call.compactedBrowserSnapshotCount} browser snapshots compacted`
                          : ""}
                      </span>
                    </span>
                    <span
                      className={
                        call.state.kind === "failed" ? "text-destructive" : "text-muted-foreground"
                      }
                    >
                      {call.state.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SdkModelInputInspector({
  modelCallId,
  threadId,
}: {
  modelCallId: FunctionArgs<typeof api.scout.modelCalls.getContext>["modelCallId"];
  threadId: FunctionArgs<typeof api.scout.modelCalls.getContext>["threadId"];
}) {
  const getContext = useAction(api.scout.modelCalls.getContext);
  const [state, setState] = useState<ModelInputLoadState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void getContext({ modelCallId, threadId }).then(
      (context) => {
        if (!active) return;
        if (!context) {
          setState({ kind: "missing" });
          return;
        }
        const snapshot = parseModelInputSnapshot(context.snapshot);
        setState(snapshot ? { kind: "ready", context, snapshot } : { kind: "unsupported" });
      },
      () => {
        if (active) setState({ kind: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [getContext, modelCallId, threadId]);

  if (state.kind === "loading") {
    return (
      <ModelInputStatus icon={<LoaderCircleIcon className="size-4 animate-spin" />}>
        Loading SDK model input
      </ModelInputStatus>
    );
  }
  if (state.kind === "missing") {
    return <ModelInputStatus>SDK model input is unavailable.</ModelInputStatus>;
  }
  if (state.kind === "failed") {
    return (
      <ModelInputStatus icon={<CircleAlertIcon className="size-4" />} destructive>
        SDK model input could not be loaded.
      </ModelInputStatus>
    );
  }
  if (state.kind === "unsupported") {
    return <ModelInputStatus>SDK model input uses an unsupported format.</ModelInputStatus>;
  }

  const { context, snapshot } = state;
  const usageMetrics = modelCallUsageMetrics(context.summary);
  return (
    <section aria-label="SDK model input" className="h-full overflow-auto px-4 py-5 @sm:px-5">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <div className="grid gap-3 border-b pb-4">
          <p className="text-muted-foreground text-xs">
            Call {context.summary.sequence} · {context.summary.modelId} ·{" "}
            {context.summary.messageCount} messages · {context.summary.toolCount} tools ·{" "}
            {formatBytes(context.summary.serializedBytes)}
          </p>
          {usageMetrics.length > 0 ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @sm:grid-cols-3">
              {usageMetrics.map((metric) => (
                <div key={metric.label} className="min-w-0">
                  <dt className="text-muted-foreground text-[0.6875rem]">{metric.label}</dt>
                  <dd className="truncate font-mono text-xs font-medium">{metric.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {context.summary.state.kind === "failed" ? (
          <p className="text-destructive text-xs" role="alert">
            {context.summary.state.failure}
          </p>
        ) : null}
        <SnapshotSection title="Instructions">
          <SnapshotValue value={snapshot.instructions} empty="None" />
        </SnapshotSection>
        <SnapshotSection title="Messages" count={snapshot.messages.length}>
          <ol className="grid gap-2">
            {snapshot.messages.map((message, index) => (
              <li key={index} className="min-w-0">
                <SnapshotItem
                  title={`${index + 1} · ${modelMessageRole(message)}`}
                  value={message}
                />
              </li>
            ))}
          </ol>
        </SnapshotSection>
        <SnapshotSection title="Tools" count={snapshot.tools?.length ?? 0}>
          {snapshot.tools && snapshot.tools.length > 0 ? (
            <ol className="grid gap-2">
              {snapshot.tools.map((tool, index) => (
                <li key={index} className="min-w-0">
                  <SnapshotItem title={`${index + 1} · ${modelToolName(tool)}`} value={tool} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-xs">None</p>
          )}
        </SnapshotSection>
        <SnapshotSection title="Settings">
          <SnapshotValue value={snapshot.settings} />
        </SnapshotSection>
      </div>
    </section>
  );
}

export function parseModelInputSnapshot(snapshot: string) {
  try {
    const parsed = modelInputSnapshotSchema.safeParse(JSON.parse(snapshot));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function formatCallSize(call: ModelCallSummary) {
  const messages = `${call.messageCount} ${call.messageCount === 1 ? "message" : "messages"}`;
  const tools = `${call.toolCount} ${call.toolCount === 1 ? "tool" : "tools"}`;
  return `${messages} · ${tools} · ${formatBytes(call.serializedBytes)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  const kilobytes = bytes / 1_000;
  return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`;
}

function modelCallUsageMetrics(call: ModelCallSummary) {
  if (call.state.kind !== "completed") return [];

  const { usage } = call.state;
  return [
    usage.promptTokens === undefined
      ? null
      : { label: "Input tokens", value: formatNumber(usage.promptTokens) },
    usage.cachedInputTokens === undefined
      ? null
      : { label: "Cached input", value: formatNumber(usage.cachedInputTokens) },
    usage.completionTokens === undefined
      ? null
      : { label: "Output tokens", value: formatNumber(usage.completionTokens) },
    usage.reasoningTokens === undefined
      ? null
      : { label: "Reasoning tokens", value: formatNumber(usage.reasoningTokens) },
    usage.totalTokens === undefined
      ? null
      : { label: "Total tokens", value: formatNumber(usage.totalTokens) },
    usage.costUsd === undefined
      ? null
      : { label: "Estimated cost", value: formatCostUsd(usage.costUsd) },
  ].filter((metric) => metric !== null);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCostUsd(cost: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: cost < 0.01 ? 6 : cost < 1 ? 4 : 2,
  }).format(cost);
}

function modelMessageRole(message: z.output<typeof jsonValueSchema>) {
  const parsed = messageLabelSchema.safeParse(message);
  return parsed.success ? parsed.data.role : "message";
}

function modelToolName(tool: z.output<typeof jsonValueSchema>) {
  const parsed = toolLabelSchema.safeParse(tool);
  return parsed.success ? parsed.data.name : "tool";
}

function SnapshotSection({
  children,
  count,
  title,
}: {
  children: ReactNode;
  count?: number;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger className="group/snapshot-section flex w-full items-center gap-2 border-b py-2 text-left text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/snapshot-section:rotate-90" />
        {title}
        {count === undefined ? null : (
          <span className="text-muted-foreground ml-auto font-normal">{count}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function SnapshotItem({
  title,
  value,
}: {
  title: string;
  value: z.output<typeof jsonValueSchema>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-muted/20">
      <CollapsibleTrigger className="group/snapshot-item flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[0.6875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ChevronRightIcon className="size-3 shrink-0 transition-transform group-data-[state=open]/snapshot-item:rotate-90" />
        <span className="truncate">{title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-2">
        <SnapshotValue value={value} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function SnapshotValue({
  value,
  empty,
}: {
  value: z.output<typeof jsonValueSchema>;
  empty?: string;
}) {
  const text =
    value === null && empty
      ? empty
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  return (
    <pre className="bg-muted/35 overflow-x-auto rounded-lg border p-3 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

function ModelInputStatus({
  children,
  destructive = false,
  icon,
}: {
  children: ReactNode;
  destructive?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div
      className="grid h-full place-items-center p-6 text-center"
      role={destructive ? "alert" : "status"}
    >
      <p
        className={`${destructive ? "text-destructive" : "text-muted-foreground"} flex items-center gap-2 text-sm`}
      >
        {icon}
        {children}
      </p>
    </div>
  );
}
