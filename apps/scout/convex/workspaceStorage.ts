import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getRuntimeEnv } from "./runtimeEnv";
import { WORKSPACE_ROOT, type WorkspaceTarget } from "./workspaceModel";

export function workspaceFileKey(
  args: {
    uploadId: string;
    path: string;
    userId: Id<"users">;
  } & WorkspaceTarget,
) {
  const deploymentUrl = getRuntimeEnv("CONVEX_CLOUD_URL");
  if (!deploymentUrl) throw new Error("Convex deployment URL is not configured");
  let owner: string;
  switch (args.kind) {
    case "site":
      owner = `sites/${encodeURIComponent(args.site)}`;
      break;
    case "chat":
      owner = `users/${args.userId}/threads/${encodeURIComponent(args.threadId)}`;
      break;
    case "agent_session":
      owner = `users/${args.userId}/agent-sessions/${args.sessionId}`;
      break;
    default: {
      const exhaustive: never = args;
      return exhaustive;
    }
  }
  const prefix = `deployments/${encodeURIComponent(new URL(deploymentUrl).host)}/${owner}/files`;
  const relativePath = args.path
    .slice(WORKSPACE_ROOT.length + 1)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${prefix}/${relativePath}/${args.uploadId}`;
}

export function workspaceStorageConfigured() {
  return Boolean(
    getRuntimeEnv("R2_BUCKET") &&
    getRuntimeEnv("R2_ENDPOINT") &&
    getRuntimeEnv("R2_ACCESS_KEY_ID") &&
    getRuntimeEnv("R2_SECRET_ACCESS_KEY"),
  );
}

export function workspaceStorage() {
  const R2_BUCKET = getRuntimeEnv("R2_BUCKET");
  const R2_ENDPOINT = getRuntimeEnv("R2_ENDPOINT");
  const R2_ACCESS_KEY_ID = getRuntimeEnv("R2_ACCESS_KEY_ID");
  const R2_SECRET_ACCESS_KEY = getRuntimeEnv("R2_SECRET_ACCESS_KEY");
  if (!R2_BUCKET || !R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error(
      "Workspace storage is not configured. Set R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in this Convex deployment.",
    );
  }
  return new R2(components.r2, {
    bucket: R2_BUCKET,
    endpoint: R2_ENDPOINT,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  });
}
