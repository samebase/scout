import type { ModelMessage } from "ai";
import { z } from "zod";

type ToolMessage = Extract<ModelMessage, { role: "tool" }>;
type ToolResultPart = Extract<ToolMessage["content"][number], { type: "tool-result" }>;
type ToolResultOutput = ToolResultPart["output"];

const SUPERSEDED_BROWSER_SNAPSHOT = "[superseded by a newer browser snapshot]";
const browserSnapshotSchema = z.object({ currentPage: z.string().min(1) }).catchall(z.json());

function isBrowserTool(toolName: string) {
  return toolName === "create_new_firecrawl_session" || toolName.startsWith("browser_");
}

function browserSnapshot(output: ToolResultOutput) {
  if (output.type !== "json") return null;
  const parsed = browserSnapshotSchema.safeParse(output.value);
  return parsed.success ? { output, value: parsed.data } : null;
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
            if (part.type !== "tool-result" || !isBrowserTool(part.toolName)) {
              return part;
            }
            const snapshot = browserSnapshot(part.output);
            if (!snapshot) return part;
            if (!keptLatestSnapshot) {
              keptLatestSnapshot = true;
              return part;
            }
            return {
              ...part,
              output: {
                ...snapshot.output,
                value: {
                  ...snapshot.value,
                  currentPage: SUPERSEDED_BROWSER_SNAPSHOT,
                },
              },
            };
          })
          .toReversed(),
      };
    })
    .toReversed();
}
