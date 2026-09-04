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
import {
  countGenerationSteps,
  parseScoutMessageParts,
  type ScoutMessagePart,
  type ScoutToolActivity,
} from "#lib/scout-message-parts";

export type ScoutRunMessage = FunctionReturnType<
  typeof api.scout.chats.listMessages
>["page"][number];

type ScoutRunMetadata = NonNullable<ScoutRunMessage["metadata"]>;

const tokenNumber = new Intl.NumberFormat();

export function scoutModelLabel(model: string) {
  switch (model) {
    case "openai/gpt-5.6-luna":
      return "Luna";
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
  const parts = parseScoutMessageParts(message.parts);

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <MessageHeader>{label}</MessageHeader>
        {parts.map((part, index) => (
          <MessagePart
            key={partKey(part, index)}
            part={part}
            role={message.role}
            showText={showText}
          />
        ))}
        {metadata?.failure ? (
          <Marker className="text-destructive" role="status">
            <MarkerIcon>
              <CircleAlertIcon />
            </MarkerIcon>
            <MarkerContent className="whitespace-pre-wrap">
              Generation failed: {metadata.failure}
            </MarkerContent>
          </Marker>
        ) : message.status === "failed" ? (
          <Marker className="text-destructive" role="status">
            <MarkerIcon>
              <CircleAlertIcon />
            </MarkerIcon>
            <MarkerContent>Generation failed.</MarkerContent>
          </Marker>
        ) : null}
        {!metadata?.failure && (message.status === "pending" || message.status === "streaming") ? (
          <MessageFooter>
            <LoaderCircleIcon className="mr-1 size-3 animate-spin" />
            Scout is working
          </MessageFooter>
        ) : metadata ? (
          <MessageFooter>{formatRunMetadata(metadata, countGenerationSteps(parts))}</MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
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
  part: ScoutMessagePart;
  role: ScoutRunMessage["role"];
  showText: boolean;
}) {
  if (part.kind === "text") {
    if (!showText || !part.text) return null;
    return (
      <Bubble
        variant={role === "user" ? "default" : role === "system" ? "secondary" : "ghost"}
        align={role === "user" ? "end" : "start"}
      >
        <BubbleContent className="whitespace-pre-wrap">{part.text}</BubbleContent>
      </Bubble>
    );
  }

  if (part.kind === "tool") return <ToolActivity tool={part.tool} />;
  if (part.kind === "step") return null;

  if (part.kind === "reasoning") {
    return (
      <Collapsible className="text-muted-foreground text-xs">
        <CollapsibleTrigger className="hover:text-foreground flex items-center gap-1 py-1">
          <ChevronRightIcon className="size-3 transition-transform [[data-state=open]>&]:rotate-90" />
          Reasoning
        </CollapsibleTrigger>
        <CollapsibleContent className="border-l pl-4 whitespace-pre-wrap">
          {part.text}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  if (part.kind === "source") {
    return (
      <Marker>
        <MarkerContent>
          Source:{" "}
          <a href={part.url} target="_blank" rel="noreferrer">
            {part.title}
          </a>
        </MarkerContent>
      </Marker>
    );
  }

  return (
    <Marker>
      <MarkerContent>{part.label}</MarkerContent>
    </Marker>
  );
}

function ToolActivity({ tool }: { tool: ScoutToolActivity }) {
  const isError = tool.error !== undefined;
  const isComplete = tool.state === "output-available";

  return (
    <Collapsible
      className={
        isError
          ? "border-destructive/50 bg-destructive/5 rounded-[0.75rem] border px-3 py-2.5"
          : "rounded-[0.75rem] border bg-muted/35 px-3 py-2.5"
      }
    >
      <CollapsibleTrigger className="group/tool flex w-full items-start gap-2 text-left">
        <Marker className={`items-start${isError ? " text-destructive" : " text-foreground"}`}>
          <MarkerIcon className="mt-0.5">
            {isError ? <CircleAlertIcon /> : isComplete ? <CheckCircle2Icon /> : <WrenchIcon />}
          </MarkerIcon>
          <MarkerContent className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono text-xs">{tool.name}</span>
                {tool.repairedInputFields.length > 0 ? (
                  <span className="shrink-0 text-[0.6875rem] font-medium text-amber-700 dark:text-amber-400">
                    JSON parsed
                  </span>
                ) : null}
              </span>
              <span
                className={
                  isError
                    ? "text-destructive shrink-0 text-[0.6875rem]"
                    : "text-muted-foreground shrink-0 text-[0.6875rem]"
                }
              >
                {isError ? "error" : tool.state.replaceAll("-", " ")}
              </span>
            </span>
            {tool.inputPreview ? (
              <span
                className={`mt-1 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-4${isError ? " text-destructive/90" : " text-muted-foreground"}`}
              >
                {tool.inputPreview}
              </span>
            ) : null}
          </MarkerContent>
        </Marker>
        <ChevronRightIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0 transition-transform group-data-[state=open]/tool:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <dl className="grid gap-3 border-t pt-3">
          {tool.repairedInputFields.length > 0 ? (
            <ToolValue label="JSON-parsed fields" value={tool.repairedInputFields.join(", ")} />
          ) : null}
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
  value: string;
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
      <dd
        className={`mt-1 overflow-x-auto rounded-md bg-background p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words${destructive ? " text-destructive" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function partKey(part: ScoutMessagePart, index: number) {
  if (part.kind === "tool") return part.tool.toolCallId;
  if (part.kind === "reasoning" && part.id) return part.id;
  if (part.kind === "source") return part.id;
  return `${part.kind}-${index}`;
}
