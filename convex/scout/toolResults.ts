"use node";

import { createHash, randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { omitNullish } from "../../shared/omitNullish";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { MAX_WORKSPACE_FILE_BYTES, WORKSPACE_ROOT } from "../workspaceModel";
import { workspaceFileKey, workspaceStorage } from "../workspaceStorage";

export const INLINE_TOOL_RESULT_BYTES = 8_000;
const EXCERPT_CHARACTERS = 1_500;
const jsonValueSchema = z.json();
const mcpTextResultSchema = z.object({
  content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
});

export function hasWorkspaceResult(toolName: string) {
  return [
    "web_search",
    "web_map",
    "web_crawl",
    "list_messages",
    "search_messages",
    "get_thread",
  ].includes(toolName);
}

export async function saveLargeToolResult(
  ctx: ActionCtx,
  scope: { threadId: string; userId: Id<"users"> },
  toolName: string,
  output: unknown,
) {
  const value = jsonValueSchema.parse(output);
  const serialized = JSON.stringify(value, null, 2);
  // Provider errors must remain immediately visible, including MCP isError responses.
  const failed =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value["isError"] === true || value["success"] === false);
  if (new TextEncoder().encode(serialized).byteLength <= INLINE_TOOL_RESULT_BYTES || failed) {
    return { kind: "inline" as const, value };
  }
  // Save the payload of a single-text MCP response, not JSON nested inside a JSON string.
  const mcp = mcpTextResultSchema.safeParse(value);
  let fileValue = value;
  if (mcp.success) {
    const text = mcp.data.content[0].text;
    try {
      fileValue = jsonValueSchema.parse(JSON.parse(text));
    } catch {
      fileValue = text;
    }
  }
  const text = typeof fileValue === "string" ? fileValue : JSON.stringify(fileValue, null, 2);
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_WORKSPACE_FILE_BYTES) {
    throw new Error(
      `The ${toolName} result is too large to save (${bytes.byteLength} bytes; limit ${MAX_WORKSPACE_FILE_BYTES}). No truncated copy was saved. Request fewer results or a smaller scope.`,
    );
  }
  const storage = workspaceStorage();
  const snapshot = await ctx.runMutation(internal.scout.workspaces.snapshot, scope);
  const uploadId = randomUUID();
  const extension = typeof fileValue === "string" ? "txt" : "json";
  const path = `${WORKSPACE_ROOT}/results/${toolName}-${uploadId.slice(0, 8)}.${extension}`;
  const key = workspaceFileKey({ ...scope, uploadId, path });
  const retrievedAt = new Date();
  await storage.store(ctx, bytes, {
    key,
    type:
      typeof fileValue === "string"
        ? "text/plain; charset=utf-8"
        : "application/json; charset=utf-8",
  });
  await ctx.runMutation(internal.scout.workspaces.addFile, {
    workspaceId: snapshot.workspaceId,
    userId: scope.userId,
    entry: {
      kind: "file",
      path,
      key,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mode: 0o644,
      mtime: retrievedAt.getTime(),
    },
  });
  return {
    kind: "file" as const,
    value: {
      path,
      byteCount: bytes.byteLength,
      tool: toolName,
      retrievedAt: retrievedAt.toISOString(),
      excerpt: Array.from(text).slice(0, EXCERPT_CHARACTERS).join(""),
      excerptTruncated: true,
    },
  };
}

export function withWorkspaceResults(
  ctx: ActionCtx,
  scope: { threadId: string; userId: Id<"users"> },
  tools: ToolSet,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, source]) => {
      if (source.type === "provider") return [name, source];
      const execute = source.execute;
      if (!hasWorkspaceResult(name) || !execute) return [name, source];
      return [
        name,
        tool<unknown, Awaited<ReturnType<typeof saveLargeToolResult>>, Record<string, unknown>>({
          inputSchema: source.inputSchema,
          ...omitNullish({ strict: source.strict }),
          description: (options) =>
            `${(typeof source.description === "function" ? source.description(options) : source.description) ?? ""} Large results are saved in /workspace/results as JSON (or plain text); use bash to search the returned path.`,
          execute: async (input, options) =>
            saveLargeToolResult(ctx, scope, name, await execute(input, options)),
          toModelOutput: ({ output, ...options }) => {
            if (output.kind === "inline" && source.toModelOutput) {
              return source.toModelOutput({ ...options, output: output.value });
            }
            return { type: "json", value: output.value };
          },
        }),
      ];
    }),
  );
}
