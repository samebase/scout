import type { FunctionReturnType } from "convex/server";
import { ChevronRightIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { ToolActivityRow, ToolValue } from "#components/tool-activity";
import { toolActivityLinks, type ToolActivity } from "../../shared/toolActivity";
import { api } from "../../convex/_generated/api";
import { SCOUT_REASONING_LABELS } from "../../shared/scoutReasoning";
import { Bubble, BubbleContent } from "#components/ui/bubble";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "#components/ui/marker";
import { Message, MessageContent, MessageFooter, MessageHeader } from "#components/ui/message";
import { ScoutModelCalls } from "#components/scout-model-input";
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
    case "deepseek/deepseek-v4-flash-0731":
      return "DeepSeek V4 Flash";
    default:
      return model;
  }
}

export function ScoutRunMessageView({
  message,
  onSelectModelCall,
  showText = true,
}: {
  message: ScoutRunMessage;
  onSelectModelCall?: (modelCallId: string) => void;
  showText?: boolean;
}) {
  const isUser = message.role === "user";
  const label = isUser ? "You" : message.role === "system" ? "System" : "Scout";
  const metadata = message.metadata;
  const parts = parseScoutMessageParts(message.parts);

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <MessageHeader>
          {label}
          <RunReference label="Message ID" value={message.id} />
        </MessageHeader>
        {parts.map((part, index) => (
          <MessagePart
            key={partKey(part, index)}
            part={part}
            role={message.role}
            showText={showText}
            active={
              metadata
                ? metadata.outcome.kind === "pending"
                : message.status === "pending" || message.status === "streaming"
            }
          />
        ))}
        {metadata?.outcome.kind === "failed" ? (
          <Marker className="text-destructive" role="status">
            <MarkerIcon>
              <CircleAlertIcon />
            </MarkerIcon>
            <MarkerContent className="whitespace-pre-wrap">
              Generation failed: {metadata.outcome.failure}
            </MarkerContent>
          </Marker>
        ) : message.status === "failed" &&
          metadata?.outcome.kind !== "stopping" &&
          metadata?.outcome.kind !== "stopped" ? (
          <Marker className="text-destructive" role="status">
            <MarkerIcon>
              <CircleAlertIcon />
            </MarkerIcon>
            <MarkerContent>Generation failed.</MarkerContent>
          </Marker>
        ) : null}
        {metadata?.outcome.kind === "stopping" ? (
          <MessageFooter>
            <LoaderCircleIcon className="mr-1 size-3 animate-spin" />
            Stopping Scout
          </MessageFooter>
        ) : metadata?.outcome.kind === "pending" &&
          (message.status === "pending" || message.status === "streaming") ? (
          <MessageFooter>
            <LoaderCircleIcon className="mr-1 size-3 animate-spin" />
            Scout is working
          </MessageFooter>
        ) : metadata ? (
          <MessageFooter>
            {metadata.outcome.kind === "stopped" ? "Stopped · " : ""}
            {formatRunMetadata(metadata, countGenerationSteps(parts))}
          </MessageFooter>
        ) : null}
        {metadata && onSelectModelCall ? (
          <ScoutModelCalls turnId={metadata.turnId} onSelect={onSelectModelCall} />
        ) : null}
      </MessageContent>
    </Message>
  );
}

export function formatRunMetadata(metadata: ScoutRunMetadata, generationSteps: number) {
  const parts: string[] = [];
  if (metadata.scout?.displayName) parts.push(metadata.scout.displayName);
  if (metadata.model) parts.push(scoutModelLabel(metadata.model));
  if (metadata.model === "openai/gpt-5.6-luna") {
    parts.push(
      `${metadata.reasoningEffort ? SCOUT_REASONING_LABELS[metadata.reasoningEffort] : "Default"} effort`,
    );
  }
  parts.push(`${tokenNumber.format(generationSteps)} ${generationSteps === 1 ? "step" : "steps"}`);
  if (metadata.usage?.promptTokens !== undefined) {
    parts.push(`${tokenNumber.format(metadata.usage.promptTokens)} input`);
  }
  if (metadata.usage?.completionTokens !== undefined) {
    parts.push(`${tokenNumber.format(metadata.usage.completionTokens)} output`);
  }
  if (metadata.usage?.reasoningTokens !== undefined) {
    parts.push(`${tokenNumber.format(metadata.usage.reasoningTokens)} reasoning`);
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
  active,
}: {
  part: ScoutMessagePart;
  role: ScoutRunMessage["role"];
  showText: boolean;
  active: boolean;
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

  if (part.kind === "tool") return <LabToolActivity tool={part.tool} active={active} />;
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

function toolState(tool: ScoutToolActivity, active: boolean): ToolActivity["state"] {
  if (tool.error !== undefined) return "failed";
  switch (tool.state) {
    case "output-available":
      return "completed";
    case "output-error":
      return "failed";
    case "output-denied":
      return "interrupted";
    case "input-streaming":
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return active ? "running" : "interrupted";
  }
}

function LabToolActivity({ tool, active }: { tool: ScoutToolActivity; active: boolean }) {
  return (
    <ToolActivityRow
      tool={{
        id: tool.toolCallId,
        name: tool.name,
        state: toolState(tool, active),
        input: tool.input ?? null,
        output: tool.output ?? null,
        error: tool.error ?? null,
        preview: tool.inputPreview?.replace(/\s+/g, " ") ?? null,
        links: toolActivityLinks(tool.output),
        captures: [],
      }}
    >
      <div>
        <dt className="text-[11px] text-muted-foreground">Tool call</dt>
        <dd>
          <RunReference label="Tool call ID" value={tool.toolCallId} />
        </dd>
      </div>
      {tool.repairedInputFields.length > 0 && (
        <ToolValue label="JSON-parsed fields" value={tool.repairedInputFields.join(", ")} />
      )}
    </ToolActivityRow>
  );
}

function RunReference({ label, value }: { label: string; value: string }) {
  const visibleValue = value.length <= 12 ? value : value.slice(-8);
  return (
    <span
      title={`${label}: ${value}`}
      data-reference-id={value}
      className="text-muted-foreground/70 select-all font-mono text-[0.625rem] font-normal"
    >
      #{visibleValue}
    </span>
  );
}

function partKey(part: ScoutMessagePart, index: number) {
  if (part.kind === "tool") return part.tool.toolCallId;
  if (part.kind === "reasoning" && part.id) return part.id;
  if (part.kind === "source") return part.id;
  return `${part.kind}-${index}`;
}
