export const TASK_WORKSPACE_VIEWS = ["live", "replay", "transcript"] as const;

export type TaskWorkspaceView = (typeof TASK_WORKSPACE_VIEWS)[number];

export type TaskWorkspaceSearch = {
  session?: string;
  view?: TaskWorkspaceView;
};

export function parseTaskWorkspaceSearch(search: Record<string, unknown>): TaskWorkspaceSearch {
  const view = TASK_WORKSPACE_VIEWS.find((candidate) => candidate === search["view"]);
  return {
    ...(typeof search["session"] === "string" ? { session: search["session"] } : {}),
    ...(view === undefined ? {} : { view }),
  };
}
