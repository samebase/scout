import { z } from "zod";
import { providerUsage } from "../../../shared/openaiAgents";

export const session = z.object({
  id: z.string(),
  status: z.enum(["idle", "in_progress", "requires_action", "failed"]),
  error: z.string().nullable(),
  usage: providerUsage,
  required_actions: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("function_call"),
        call_id: z.string(),
        turn_id: z.string(),
        name: z.string(),
        arguments: z.unknown(),
      }),
      z.object({ type: z.literal("environment_connection"), environment_id: z.string() }),
    ]),
  ),
});

export const turn = z.object({
  id: z.string(),
  subagent_id: z.string().nullable(),
  status: z.enum(["queued", "in_progress", "waiting", "completed", "cancelled", "failed"]),
  error: z.unknown(),
});

export const tools = z.array(
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("web_search") }),
    z.object({
      type: z.literal("function"),
      name: z.string(),
      description: z.string(),
      parameters: z.record(z.string(), z.unknown()),
    }),
  ]),
);

const baseItem = z.looseObject({
  id: z.string(),
  status: z.enum(["in_progress", "completed", "incomplete", "failed"]).nullable(),
});
const providerItem = z.discriminatedUnion("type", [
  baseItem.extend({
    type: z.literal("message"),
    role: z.enum(["assistant", "user", "system", "developer"]),
    content: z.array(
      z.discriminatedUnion("type", [
        z.looseObject({ type: z.literal("input_image") }),
        z.looseObject({ type: z.literal("input_text"), text: z.string() }),
        z.looseObject({ type: z.literal("output_text"), text: z.string() }),
        z.looseObject({ type: z.literal("refusal"), text: z.string() }),
      ]),
    ),
  }),
  baseItem.extend({
    type: z.literal("reasoning"),
    summary: z.array(z.looseObject({ text: z.string() })),
  }),
  baseItem.extend({ type: z.literal("function_call"), name: z.string() }),
  baseItem.extend({ type: z.literal("function_call_output"), error: z.string().nullable() }),
  baseItem.extend({
    type: z.enum([
      "command_execution",
      "web_search_call",
      "mcp_call",
      "create_subagent_call",
      "send_subagent_input_call",
      "resume_subagent_call",
      "wait_for_subagents_call",
      "interrupt_subagent_call",
      "close_subagent_call",
    ]),
  }),
  z.looseObject({ id: z.string(), type: z.literal("agent_message") }),
]);

export function presentItem(value: unknown) {
  const item = providerItem.parse(value);
  if (
    item.type !== "agent_message" &&
    item.status !== "completed" &&
    item.status !== "incomplete" &&
    item.status !== "failed"
  )
    return null;
  let kind: string = item.type;
  let text: string;
  switch (item.type) {
    case "message":
      kind = item.role;
      text = item.content
        .map((part) => (part.type === "input_image" ? "[Image]" : part.text))
        .join("\n");
      break;
    case "reasoning":
      text = item.summary.map((part) => part.text).join("\n");
      break;
    case "function_call":
      text = item.name;
      break;
    case "function_call_output":
      text = item.error ?? "Tool result";
      break;
    case "command_execution":
      text = "Shell";
      break;
    case "web_search_call":
      text = "Web search";
      break;
    case "mcp_call":
      text = "MCP tool";
      break;
    case "agent_message":
      text = "Agent message";
      break;
    case "create_subagent_call":
    case "send_subagent_input_call":
    case "resume_subagent_call":
    case "wait_for_subagents_call":
    case "interrupt_subagent_call":
    case "close_subagent_call":
      text = item.type;
      break;
    default: {
      const unhandled: never = item;
      throw new Error(`Unsupported session item: ${JSON.stringify(unhandled)}`);
    }
  }
  const details = JSON.stringify(item, null, 2);
  if (new TextEncoder().encode(details).length > 500_000)
    throw new Error("OpenAI session item exceeds the 500 KB display limit");
  return { providerItemId: item.id, kind, text, details, complete: true };
}
