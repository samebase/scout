import { createFileRoute } from "@tanstack/react-router";
import { TaskWorkspace } from "#components/task-workspace";

export const Route = createFileRoute("/products/$domain/tasks/$taskId/attempts/$attemptId")({
  component: TaskAttemptPage,
});

function TaskAttemptPage() {
  const { attemptId, domain, taskId } = Route.useParams();
  return <TaskWorkspace attemptId={attemptId} domain={domain} taskId={taskId} />;
}
