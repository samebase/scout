import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { useSidebarActions } from "@samebase/sidebars/SidebarRuntime";
import { Link } from "@tanstack/react-router";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { LoadOnScroll } from "#components/load-on-scroll";
import { cn } from "#lib/utils";

type Activity = FunctionReturnType<typeof api.scout.activity.list>["page"][number];
type Task = Pick<Activity, "threadId" | "title" | "createdAt">;

export function TaskNavigation({
  site,
  scope,
  current,
  view,
}: {
  site: string;
  scope: "public" | "mine";
  current: Task;
  view: "walkthrough" | "chat";
}) {
  const tasks = usePaginatedQuery(
    api.scout.activity.list,
    { site, scope },
    { initialNumItems: 10 },
  );
  const currentIsLoaded = tasks.results.some((task) => task.threadId === current.threadId);
  return (
    <PaneFrame
      scrollRestorationId={`tasks-${site}-${scope}`}
      content={
        <nav aria-label={`Tasks for ${site}`} className="pr-2">
          <ul className="space-y-1">
            {!currentIsLoaded && <TaskLink task={current} selected view={view} />}
            {tasks.results.map((task) => (
              <TaskLink
                key={task.threadId}
                task={task}
                selected={task.threadId === current.threadId}
                view={
                  task.threadId === current.threadId
                    ? view
                    : task.walkthrough
                      ? "walkthrough"
                      : "chat"
                }
              />
            ))}
          </ul>
          {tasks.status === "LoadingFirstPage" && (
            <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
              Loading tasks…
            </p>
          )}
          <LoadOnScroll status={tasks.status} onLoad={() => tasks.loadMore(10)} />
        </nav>
      }
    />
  );
}

function TaskLink({
  task,
  selected,
  view,
}: {
  task: Task;
  selected: boolean;
  view: "walkthrough" | "chat";
}) {
  const { setMobilePane } = useSidebarActions();
  return (
    <li>
      <Link
        to="/review"
        search={{ thread: task.threadId, view }}
        aria-current={selected ? "page" : undefined}
        onClick={() => setMobilePane("main")}
        className={cn(
          "block rounded-lg border px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "border-primary/25 bg-primary/10" : "border-transparent hover:bg-secondary",
        )}
      >
        <span className="line-clamp-3 text-sm leading-snug font-medium wrap-anywhere">
          {task.title ?? "New review"}
        </span>
        <time
          dateTime={new Date(task.createdAt).toISOString()}
          className="mt-1.5 block text-xs text-muted-foreground"
        >
          {new Date(task.createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
      </Link>
    </li>
  );
}
