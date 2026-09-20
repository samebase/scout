import type { AgentSessionItem } from "openai/resources/beta/agents/agents";
import { WALKTHROUGH_CONTEXT_END, WALKTHROUGH_CONTEXT_START } from "./instructions";

export function itemIsComplete(item: AgentSessionItem) {
  return (
    item.type === "agent_message" ||
    item.status === "completed" ||
    item.status === "failed" ||
    item.status === "incomplete"
  );
}

export function presentItem(item: AgentSessionItem) {
  if (item.id === null) throw new Error("OpenAI returned a session item without an ID");
  let kind: string = item.type;
  let text: string;
  switch (item.type) {
    case "message":
      kind = item.role;
      text = item.content
        .filter(
          (part, index) =>
            !(
              item.role === "user" &&
              item.content.length === 2 &&
              item.content[0]?.type === "input_text" &&
              index === 1 &&
              part.type === "input_text" &&
              part.text.startsWith(WALKTHROUGH_CONTEXT_START) &&
              part.text.endsWith(WALKTHROUGH_CONTEXT_END)
            ),
        )
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
    throw new Error("OpenAI session item exceeds the experiment's 500 KB display limit");
  return {
    providerItemId: item.id,
    kind,
    text,
    details,
    complete: itemIsComplete(item),
  };
}
