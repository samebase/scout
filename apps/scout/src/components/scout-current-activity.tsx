import { ClientOnly, Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpRightIcon, LockKeyholeIcon, MonitorIcon } from "lucide-react";
import { useState } from "react";
import type { api } from "../../convex/_generated/api";
import { ActivityPreview } from "./activity-feed";

type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];

export const scoutAvailabilityLabels: Record<Scout["availability"], string> = {
  available: "Available",
  working: "Working",
  waiting: "Waiting for help",
  stopping: "Stopping",
  cleanup_failed: "Couldn't close session",
  browser_open: "Browser open",
};

export function ScoutAvailability({ scout }: { scout: Pick<Scout, "status" | "availability"> }) {
  const available = scout.availability === "available";
  const label =
    scout.status === "disabled" ? "Disabled" : scoutAvailabilityLabels[scout.availability];
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-xs font-medium">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${scout.status === "disabled" ? "bg-muted-foreground" : available ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {label}
    </span>
  );
}

export function ScoutCurrentActivity({
  activity,
  className,
}: {
  activity: Scout["currentActivity"];
  className: string;
}) {
  const [hovered, setHovered] = useState(false);
  if (!activity) return null;
  if (activity.kind === "private") {
    return (
      <div
        className={`flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground ${className}`}
      >
        <LockKeyholeIcon className="size-4" aria-hidden="true" />
        Private session
      </div>
    );
  }
  const session = activity.activity;
  return (
    <Link
      {...activity.destination}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 ${className}`}
    >
      <div className="grid aspect-[8/5] w-28 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted sm:w-36">
        {session.latestSession ? (
          <ActivityPreview session={session.latestSession} playing={hovered} />
        ) : (
          <MonitorIcon className="size-6 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium wrap-anywhere group-hover:underline">
          {session.title ?? "New chat"}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {session.primarySite && <span>{session.primarySite}</span>}
          <time dateTime={new Date(session.createdAt).toISOString()}>
            <ClientOnly fallback={new Date(session.createdAt).toISOString().slice(0, 10)}>
              {new Date(session.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </ClientOnly>
          </time>
        </div>
      </div>
      <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
