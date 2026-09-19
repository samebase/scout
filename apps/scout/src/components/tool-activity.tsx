import { useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronRightIcon,
  CheckIcon,
  CircleAlertIcon,
  ImageIcon,
  LoaderCircleIcon,
  WrenchIcon,
} from "lucide-react";
import type { ToolActivity } from "../../shared/toolActivity";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "#components/ui/dialog";
import { cn } from "#lib/utils";

const statusLabels = {
  running: "Running",
  completed: "Finished",
  failed: "Failed",
  interrupted: "Interrupted",
} satisfies Record<ToolActivity["state"], string>;

export function ToolActivityRow({ tool, children }: { tool: ToolActivity; children?: ReactNode }) {
  return (
    <Collapsible className="min-w-0 text-xs" data-tool-call={tool.id}>
      <CollapsibleTrigger
        className={cn(
          "group/tool flex min-h-9 w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tool.state === "failed" && "text-destructive",
        )}
        aria-label={`${tool.name}: ${statusLabels[tool.state]}`}
      >
        <ChevronRightIcon
          className="size-3 shrink-0 transition-transform group-data-[state=open]/tool:rotate-90"
          aria-hidden="true"
        />
        {tool.state === "running" ? (
          <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        ) : tool.state === "failed" ? (
          <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
        ) : tool.state === "completed" ? (
          <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <WrenchIcon className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 shrink truncate font-medium">{tool.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] opacity-80">
          {tool.preview}
        </span>
        {tool.state !== "completed" && (
          <span className="shrink-0 text-[11px]">{statusLabels[tool.state]}</span>
        )}
      </CollapsibleTrigger>
      {(tool.links.length > 0 || tool.captures.length > 0) && (
        <div className="ml-7 flex flex-wrap gap-x-4 gap-y-1 pb-1">
          {tool.captures.map((id, index) => (
            <ToolScreenshot
              key={id}
              id={id}
              label={tool.captures.length === 1 ? "Screenshot" : `Screenshot ${index + 1}`}
            />
          ))}
          {tool.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
      <CollapsibleContent className="ml-7 border-l pl-3">
        <dl className="space-y-3 py-2">
          {tool.input !== null && <ToolValue label="Input" value={tool.input} />}
          {tool.output !== null && <ToolValue label="Output" value={tool.output} />}
          {tool.error !== null && (
            <ToolValue
              label={tool.state === "interrupted" ? "Reason" : "Error"}
              value={tool.error}
              destructive={tool.state === "failed"}
            />
          )}
          {children}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

type ScreenshotState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ready";
      image: NonNullable<FunctionReturnType<typeof api.tasks.screenshots.imageUrl>>;
    }
  | { kind: "failed" };

function ToolScreenshot({ id, label }: { id: Id<"agentsApiScreenshots">; label: string }) {
  const imageUrl = useAction(api.tasks.screenshots.imageUrl);
  const [state, setState] = useState<ScreenshotState>({ kind: "idle" });

  async function load() {
    if (
      state.kind === "loading" ||
      (state.kind === "ready" && state.image.expiresAtMs > Date.now())
    )
      return;
    setState({ kind: "loading" });
    try {
      const image = await imageUrl({ screenshotId: id });
      setState(image ? { kind: "ready", image } : { kind: "failed" });
    } catch {
      setState({ kind: "failed" });
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DialogTrigger className="inline-flex min-h-7 items-center gap-1.5 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ImageIcon className="size-3.5" aria-hidden="true" /> {label}
      </DialogTrigger>
      <DialogContent className="max-h-[95dvh] sm:max-w-[min(1200px,95vw)]">
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription className="sr-only">
          Screenshot saved during this tool call.
        </DialogDescription>
        <div
          className="flex h-[70dvh] min-h-0 items-center justify-center"
          aria-busy={state.kind === "idle" || state.kind === "loading"}
        >
          {state.kind === "ready" ? (
            <img
              src={state.image.url}
              alt="Screenshot saved by Scout"
              className="h-full w-full object-contain"
              onError={() => setState({ kind: "failed" })}
            />
          ) : state.kind === "failed" ? (
            <div className="space-y-3 py-8 text-center text-sm">
              <p role="alert">Couldn't load this screenshot.</p>
              <button
                className="text-primary underline underline-offset-4"
                onClick={() => void load()}
              >
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ToolValue({
  label,
  value,
  destructive = false,
}: {
  label: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt
        className={cn("mb-1 text-[11px] text-muted-foreground", destructive && "text-destructive")}
      >
        {label}
      </dt>
      <dd>
        <pre
          className={cn(
            "max-h-80 overflow-auto rounded-md bg-muted/35 p-2 text-[11px] leading-relaxed whitespace-pre-wrap wrap-anywhere",
            destructive && "text-destructive",
          )}
        >
          {value}
        </pre>
      </dd>
    </div>
  );
}
