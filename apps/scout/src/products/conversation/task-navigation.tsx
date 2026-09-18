import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { useSidebarActions } from "@samebase/sidebars/SidebarRuntime";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { LoadOnScroll } from "#components/load-on-scroll";
import { cn } from "#lib/utils";
import type { ReviewFeedSearch } from "#lib/reviewFeedSearch";

type Activity = FunctionReturnType<typeof api.scout.activity.list>["page"][number];
type Task = Pick<Activity, "threadId" | "title" | "createdAt">;

export function TaskNavigation({
  site,
  search,
  current,
  selectedThreadId,
  view,
}: {
  site: string;
  search: ReviewFeedSearch;
  current: Task;
  selectedThreadId: string;
  view: "walkthrough" | "chat";
}) {
  const scope = search.scope ?? "public";
  const tasks = usePaginatedQuery(
    api.scout.activity.list,
    { site, scope },
    { initialNumItems: 10 },
  );
  const currentIsLoaded = tasks.results.some((task) => task.threadId === current.threadId);
  return (
    <PaneFrame
      scrollRestorationId={`tasks-${site}-${scope}`}
      header={
        <Link
          to="/sites/$site"
          params={{ site }}
          search={{ ...search, view: "tasks" }}
          resetScroll={false}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-3 text-xs font-semibold text-muted-foreground hover:text-primary"
        >
          <ArrowLeftIcon size={16} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{site} tasks</span>
        </Link>
      }
      content={
        <nav aria-label={`Tasks for ${site}`} className="p-3">
          <ul className="space-y-1">
            {!currentIsLoaded && (
              <TaskLink
                task={current}
                selected={current.threadId === selectedThreadId}
                view={view}
                search={search}
              />
            )}
            {tasks.results.map((task) => (
              <TaskLink
                key={task.threadId}
                task={task}
                selected={task.threadId === selectedThreadId}
                search={search}
                view={
                  task.threadId === selectedThreadId
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
  search,
}: {
  task: Task;
  selected: boolean;
  view: "walkthrough" | "chat";
  search: ReviewFeedSearch;
}) {
  const { setMobilePane } = useSidebarActions();
  return (
    <li>
      <Link
        to="/tasks/$thread"
        params={{ thread: task.threadId }}
        resetScroll={false}
        search={{ ...search, view }}
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
