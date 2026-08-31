import { createFileRoute } from "@tanstack/react-router";
import { TaskWorkspace } from "#components/task-workspace";

export const Route = createFileRoute("/products/$domain/tasks/$taskId/")({
  component: TaskPage,
});

function TaskPage() {
  const { domain, taskId } = Route.useParams();
  return <TaskWorkspace domain={domain} taskId={taskId} />;
}
