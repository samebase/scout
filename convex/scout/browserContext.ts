import type { ModelMessage } from "ai";

type ToolMessage = Extract<ModelMessage, { role: "tool" }>;
type ToolResultPart = Extract<ToolMessage["content"][number], { type: "tool-result" }>;
type ToolResultOutput = ToolResultPart["output"];

const SUPERSEDED_BROWSER_SNAPSHOT = "[superseded by a newer browser snapshot]";

function isBrowserTool(toolName: string) {
  return toolName === "create_new_firecrawl_session" || toolName.startsWith("browser_");
}

function currentPage(output: ToolResultOutput) {
  if (output.type !== "json") return null;
  const value = output.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return typeof value["currentPage"] === "string" && value["currentPage"].length > 0
    ? value["currentPage"]
    : null;
}

function compactCurrentPage(output: ToolResultOutput): ToolResultOutput {
  if (output.type !== "json") return output;
  const value = output.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return output;
  return {
    ...output,
    value: { ...value, currentPage: SUPERSEDED_BROWSER_SNAPSHOT },
  };
}

export function compactBrowserModelContext(messages: ModelMessage[]) {
  let keptLatestSnapshot = false;
  return messages
    .toReversed()
    .map((message): ModelMessage => {
      if (message.role !== "tool") return message;
      return {
        ...message,
        content: message.content
          .toReversed()
          .map((part) => {
            if (
              part.type !== "tool-result" ||
              !isBrowserTool(part.toolName) ||
              currentPage(part.output) === null
            ) {
              return part;
            }
            if (!keptLatestSnapshot) {
              keptLatestSnapshot = true;
              return part;
            }
            return { ...part, output: compactCurrentPage(part.output) };
          })
          .toReversed(),
      };
    })
    .toReversed();
}
