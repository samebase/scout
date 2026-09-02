import { createFileRoute } from "@tanstack/react-router";
import { TaskWorkspace } from "#components/task-workspace";
import { parseTaskWorkspaceSearch } from "#lib/taskWorkspaceSearch";

export const Route = createFileRoute("/products/$domain/tasks/$taskId/")({
  validateSearch: parseTaskWorkspaceSearch,
  component: TaskPage,
});

function TaskPage() {
  const { domain, taskId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TaskWorkspace
      domain={domain}
      search={search}
      taskId={taskId}
      onSearchChange={(nextSearch) => {
        void navigate({ replace: true, search: nextSearch });
      }}
    />
  );
}
