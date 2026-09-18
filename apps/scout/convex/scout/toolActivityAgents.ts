import { z } from "zod";
import { taskToolCallSchema } from "../../shared/taskTranscript";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ToolActivity } from "../../shared/toolActivity";
import {
  parseToolValue,
  presentToolActivity,
  unwrapToolOutput,
  type ToolAudience,
} from "./toolActivity";

const status = z.enum(["in_progress", "completed", "failed", "incomplete"]);
const providerTool = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("function_call"),
    name: z.string(),
    call_id: z.string(),
    arguments: z.json(),
    status,
  }),
  z.object({
    type: z.literal("mcp_call"),
    name: z.string(),
    arguments: z.json(),
    output: z.json(),
    error: z.json(),
    status,
  }),
  z.object({
    type: z.literal("command_execution"),
    command: z.string(),
    cwd: z.string().nullable(),
    duration_ms: z.number().nullable(),
    exit_code: z.number().nullable(),
    output: z.string().nullable(),
    status,
  }),
  z.object({
    type: z.literal("web_search_call"),
    status,
    action: z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("search"),
          query: z.string().nullable(),
          queries: z.array(z.string()).nullable(),
        }),
        z.object({ type: z.literal("open_page"), url: z.string().nullable() }),
        z.object({
          type: z.literal("find_in_page"),
          url: z.string().nullable(),
          pattern: z.string().nullable(),
        }),
        z.object({ type: z.literal("other") }),
      ])
      .nullable(),
  }),
]);
const outputItem = z.object({ type: z.literal("function_call_output"), call_id: z.string() });
const supportedKinds = new Set([
  "function_call",
  "mcp_call",
  "command_execution",
  "web_search_call",
]);
const screenshotOutput = z.object({
  capture: z.object({ kind: z.literal("ready"), captureId: z.string() }),
});

function parseStoredTool(details: string) {
  // Do not include provider content in a public parse error.
  const parsed = providerTool.safeParse(parseToolValue(details));
  if (!parsed.success)
    throw new Error("Stored tool activity is invalid; inspect the admin transcript.");
  return parsed.data;
}

export async function agentsToolActivity(
  ctx: QueryCtx,
  session: Doc<"agentsApiSessions">,
  item: Doc<"agentsApiItems">,
  audience: ToolAudience,
): Promise<ToolActivity | null> {
  if (item.kind === "tool_call") {
    const call = taskToolCallSchema.parse(parseToolValue(item.details));
    return presentFunctionCall(ctx, session, item, audience, call, null);
  }
  if (!supportedKinds.has(item.kind)) return null;
  const tool = parseStoredTool(item.details);
  const active = session.state.kind === "running" || session.state.kind === "starting";
  const pending = active ? "running" : "interrupted";
  switch (tool.type) {
    case "function_call":
      return presentFunctionCall(
        ctx,
        session,
        item,
        audience,
        {
          name: tool.name,
          callId: tool.call_id,
          input: parseToolValue(tool.arguments),
        },
        tool.status === "failed" || tool.status === "incomplete" ? tool.status : null,
      );
    case "mcp_call":
      return presentToolActivity({
        id: item._id,
        name: tool.name,
        state:
          tool.status === "failed"
            ? "failed"
            : tool.status === "incomplete"
              ? "interrupted"
              : tool.status === "completed"
                ? "completed"
                : pending,
        input: parseToolValue(tool.arguments),
        output: parseToolValue(tool.output),
        error:
          tool.error === null
            ? null
            : typeof tool.error === "string"
              ? tool.error
              : JSON.stringify(tool.error),
        audience,
      });
    case "command_execution":
      return presentToolActivity({
        id: item._id,
        name: tool.type,
        state:
          tool.status === "failed"
            ? "failed"
            : tool.status === "incomplete"
              ? "interrupted"
              : tool.exit_code !== null
                ? "completed"
                : pending,
        input: { command: tool.command, cwd: tool.cwd },
        output: {
          output: tool.output,
          exit_code: tool.exit_code,
          duration_ms: tool.duration_ms,
          cwd: tool.cwd,
        },
        error: null,
        audience,
      });
    case "web_search_call":
      return presentToolActivity({
        id: item._id,
        name: tool.type,
        state:
          tool.status === "failed"
            ? "failed"
            : tool.status === "incomplete"
              ? "interrupted"
              : tool.status === "completed"
                ? "completed"
                : pending,
        input: tool.action,
        output:
          tool.action?.type === "open_page" || tool.action?.type === "find_in_page"
            ? { url: tool.action.url }
            : null,
        error: null,
        audience,
      });
  }
}

export async function pairedAgentsOutput(ctx: QueryCtx, item: Doc<"agentsApiItems">) {
  if (item.kind !== "function_call_output") return false;
  const parsed = outputItem.safeParse(parseToolValue(item.details));
  if (!parsed.success) return false;
  const call = await ctx.db
    .query("agentsApiCalls")
    .withIndex("by_session_id_and_call_id", (q) =>
      q.eq("sessionId", item.sessionId).eq("callId", parsed.data.call_id),
    )
    .unique();
  return call?.result.kind === "success" || call?.result.kind === "error";
}

async function presentFunctionCall(
  ctx: QueryCtx,
  session: Doc<"agentsApiSessions">,
  item: Doc<"agentsApiItems">,
  audience: ToolAudience,
  tool: z.infer<typeof taskToolCallSchema>,
  failure: "failed" | "incomplete" | null,
): Promise<ToolActivity> {
  const pending =
    session.state.kind === "running" || session.state.kind === "starting"
      ? "running"
      : "interrupted";
  const call = await ctx.db
    .query("agentsApiCalls")
    .withIndex("by_session_id_and_call_id", (q) =>
      q.eq("sessionId", session._id).eq("callId", tool.callId),
    )
    .unique();
  const result = call?.result;
  // The provider call item completing only means that arguments have been emitted.
  const state =
    result?.kind === "error"
      ? "failed"
      : result?.kind === "success"
        ? "completed"
        : failure === "failed"
          ? "failed"
          : failure === "incomplete"
            ? "interrupted"
            : pending;
  const output = result?.kind === "success" ? parseToolValue(result.output) : null;
  const activity = presentToolActivity({
    id: item._id,
    name: tool.name,
    state,
    input: tool.input,
    output,
    error: result?.kind === "error" ? result.error : null,
    audience,
  });
  if (tool.name === "browser_execute") {
    const capture = screenshotOutput.safeParse(unwrapToolOutput(output));
    if (capture.success) {
      const id = ctx.db.normalizeId("agentsApiScreenshots", capture.data.capture.captureId);
      const screenshot = id ? await ctx.db.get(id) : null;
      if (screenshot?.sessionId === session._id && screenshot.state.kind === "ready")
        activity.captures.push(screenshot._id);
    }
  }
  return activity;
}
