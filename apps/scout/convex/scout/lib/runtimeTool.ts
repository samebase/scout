import { validateTypes } from "@ai-sdk/provider-utils";
import type { ToolExecutionOptions, ToolSet } from "ai";

type RuntimeTool = ToolSet[string];

export function requireRuntimeTool(tools: Partial<ToolSet>, name: string) {
  const tool = tools[name];
  if (!tool || typeof tool.execute !== "function") {
    throw new Error(`Tool ${name} cannot be executed`);
  }
  const execute = tool.execute;

  return {
    execute: async (input: unknown, options: ToolExecutionOptions<unknown>): Promise<unknown> => {
      const parsed = await validateTypes({ value: input, schema: tool.inputSchema });
      return await execute(parsed, options);
    },
    toModelOutput: tool.toModelOutput,
  } satisfies {
    execute: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>;
    toModelOutput: RuntimeTool["toModelOutput"];
  };
}
