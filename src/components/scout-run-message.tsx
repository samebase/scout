import type { FunctionReturnType } from "convex/server";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  WrenchIcon,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Bubble, BubbleContent } from "#components/ui/bubble";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "#components/ui/marker";
import { Message, MessageContent, MessageFooter, MessageHeader } from "#components/ui/message";

export type ScoutRunMessage = FunctionReturnType<typeof api.scout.lab.listMessages>["page"][number];

type ScoutRunMetadata = NonNullable<ScoutRunMessage["metadata"]>;

type ToolSnapshot = {
  name: string;
  state: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
};

const tokenNumber = new Intl.NumberFormat();

export function scoutModelLabel(model: string) {
  switch (model) {
    case "qwen/qwen3.7-flash":
      return "Qwen 3.7 Flash";
    default:
      return model;
  }
}

export function ScoutRunMessageView({
  message,
  showText = true,
}: {
  message: ScoutRunMessage;
  showText?: boolean;
}) {
  const isUser = message.role === "user";
  const label = isUser ? "You" : message.role === "system" ? "System" : "Scout";
  const metadata = message.metadata;

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <MessageHeader>{label}</MessageHeader>
        {message.parts.map((part, index) => (
          <MessagePart
            key={partKey(part, index)}
            part={part}
            role={message.role}
            showText={showText}
          />
        ))}
        {message.status === "failed" ? (
          <Marker className="text-destructive" role="status">
            <MarkerIcon>
              <CircleAlertIcon />
            </MarkerIcon>
            <MarkerContent>Generation failed.</MarkerContent>
          </Marker>
        ) : metadata?.failure ? (
          <Marker className="text-destructive" role="status">
            <MarkerIcon>
              <CircleAlertIcon />
            </MarkerIcon>
            <MarkerContent>Generation failed: {metadata.failure}</MarkerContent>
          </Marker>
        ) : null}
        {!metadata?.failure && (message.status === "pending" || message.status === "streaming") ? (
          <MessageFooter>
            <LoaderCircleIcon className="mr-1 size-3 animate-spin" />
            Scout is working
          </MessageFooter>
        ) : metadata ? (
          <MessageFooter>
            {formatRunMetadata(metadata, countGenerationSteps(message.parts))}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

export function countGenerationSteps(parts: ScoutRunMessage["parts"]) {
  return parts.reduce((count, part) => {
    const record = asRecord(part);
    return record && field(record, "type") === "step-start" ? count + 1 : count;
  }, 0);
}

export function formatRunMetadata(metadata: ScoutRunMetadata, generationSteps: number) {
  const parts: string[] = [];
  if (metadata.scout?.displayName) parts.push(metadata.scout.displayName);
  if (metadata.model) parts.push(scoutModelLabel(metadata.model));
  parts.push(`${tokenNumber.format(generationSteps)} ${generationSteps === 1 ? "step" : "steps"}`);
  if (metadata.usage?.promptTokens !== undefined) {
    parts.push(`${tokenNumber.format(metadata.usage.promptTokens)} input`);
  }
  if (metadata.usage?.completionTokens !== undefined) {
    parts.push(`${tokenNumber.format(metadata.usage.completionTokens)} output`);
  }
  if (metadata.usage?.costUsd !== undefined) {
    parts.push(formatEstimatedModelCostUsd(metadata.usage.costUsd));
  }
  if (
    metadata.usage?.promptTokens === undefined &&
    metadata.usage?.completionTokens === undefined &&
    metadata.usage?.totalTokens !== undefined
  ) {
    parts.push(`${tokenNumber.format(metadata.usage.totalTokens)} tokens`);
  }
  if (metadata.durationMs !== undefined) {
    parts.push(formatDuration(metadata.durationMs));
  }
  if (metadata.firecrawlCredits !== undefined) {
    parts.push(`${tokenNumber.format(metadata.firecrawlCredits)} Firecrawl credits`);
  }
  if (metadata.firecrawlDurationMs !== undefined) {
    parts.push(`${formatDuration(metadata.firecrawlDurationMs)} browser`);
  }
  return parts.join(", ");
}

function formatDuration(durationMs: number) {
  return durationMs < 1000 ? `${Math.round(durationMs)} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

function formatEstimatedModelCostUsd(cost: number) {
  const maximumFractionDigits = cost < 0.01 ? 6 : cost < 1 ? 4 : 2;
  return `~${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.min(2, maximumFractionDigits),
    maximumFractionDigits,
  }).format(cost)} model`;
}

function MessagePart({
  part,
  role,
  showText,
}: {
  part: unknown;
  role: ScoutRunMessage["role"];
  showText: boolean;
}) {
  const record = asRecord(part);
  const rawType = record ? field(record, "type") : undefined;
  const type = typeof rawType === "string" ? rawType : "unknown";
  const text = record ? field(record, "text") : undefined;

  if (type === "text" && typeof text === "string") {
    if (!showText || !text) return null;
    return (
      <Bubble
        variant={role === "user" ? "default" : role === "system" ? "secondary" : "ghost"}
        align={role === "user" ? "end" : "start"}
      >
        <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
      </Bubble>
    );
  }

  const tool = toolSnapshot(record, type);
  if (tool) return <ToolActivity tool={tool} />;
  if (type === "step-start") return null;

  if (type === "reasoning" && typeof text === "string") {
    return (
      <Collapsible className="text-muted-foreground text-xs">
        <CollapsibleTrigger className="hover:text-foreground flex items-center gap-1 py-1">
          <ChevronRightIcon className="size-3 transition-transform [[data-state=open]>&]:rotate-90" />
          Reasoning
        </CollapsibleTrigger>
        <CollapsibleContent className="border-l pl-4 whitespace-pre-wrap">
          {text}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  const url = record ? field(record, "url") : undefined;
  if (record && type === "source-url" && typeof url === "string") {
    const rawTitle = field(record, "title");
    const title = typeof rawTitle === "string" ? rawTitle : url;
    return (
      <Marker>
        <MarkerContent>
          Source:{" "}
          <a href={url} target="_blank" rel="noreferrer">
            {title}
          </a>
        </MarkerContent>
      </Marker>
    );
  }

  return (
    <Marker>
      <MarkerContent>
        {type === "unknown" ? "Unrecognized message part" : type.replaceAll("-", " ")}
      </MarkerContent>
    </Marker>
  );
}

function ToolActivity({ tool }: { tool: ToolSnapshot }) {
  const isError = tool.state.includes("error") || tool.error !== undefined;
  const isComplete = tool.state === "output-available";

  return (
    <Collapsible className="rounded-[0.75rem] border bg-muted/35 px-3 py-2.5">
      <CollapsibleTrigger className="group/tool flex w-full items-center gap-2 text-left">
        <Marker className={isError ? "text-destructive" : "text-foreground"}>
          <MarkerIcon>
            {isError ? <CircleAlertIcon /> : isComplete ? <CheckCircle2Icon /> : <WrenchIcon />}
          </MarkerIcon>
          <MarkerContent className="flex flex-1 items-baseline justify-between gap-3">
            <span className="font-mono text-xs">{tool.name}</span>
            <span className="text-muted-foreground text-[0.6875rem]">
              {tool.state.replaceAll("-", " ")}
            </span>
          </MarkerContent>
        </Marker>
        <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[state=open]/tool:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <dl className="grid gap-3 border-t pt-3">
          {tool.input !== undefined ? <ToolValue label="Input" value={tool.input} /> : null}
          {tool.output !== undefined ? <ToolValue label="Output" value={tool.output} /> : null}
          {tool.error !== undefined ? (
            <ToolValue label="Error" value={tool.error} destructive />
          ) : null}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolValue({
  destructive = false,
  label,
  value,
}: {
  destructive?: boolean;
  label: string;
  value: unknown;
}) {
  return (
    <div>
      <dt
        className={
          destructive
            ? "text-destructive text-xs font-medium"
            : "text-muted-foreground text-xs font-medium"
        }
      >
        {label}
      </dt>
      <dd className="mt-1 overflow-x-auto rounded-md bg-background p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words">
        {formatValue(value)}
      </dd>
    </div>
  );
}

function toolSnapshot(record: object | null, type: string): ToolSnapshot | null {
  if (!record || (type !== "dynamic-tool" && !type.startsWith("tool-"))) return null;
  const rawToolName = field(record, "toolName");
  const dynamicName = typeof rawToolName === "string" ? rawToolName : null;
  const staticName = type.startsWith("tool-") ? type.slice("tool-".length) : null;
  const rawState = field(record, "state");
  const state = typeof rawState === "string" ? rawState : "unknown";
  return {
    name: dynamicName ?? staticName ?? "unknown tool",
    state,
    input: ownValue(record, "input") ?? ownValue(record, "args"),
    output: ownValue(record, "output") ?? ownValue(record, "result"),
    error: ownValue(record, "errorText") ?? ownValue(record, "error"),
  };
}

function partKey(part: unknown, index: number) {
  const record = asRecord(part);
  const stableId = record ? (field(record, "toolCallId") ?? field(record, "id")) : undefined;
  const type = record ? field(record, "type") : "part";
  return typeof stableId === "string" ? stableId : `${String(type)}-${index}`;
}

function asRecord(value: unknown): object | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function field(record: object, key: string): unknown {
  return Reflect.get(record, key);
}

function ownValue(record: object, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key) ? field(record, key) : undefined;
}

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
