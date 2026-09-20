import { validateTypes } from "@ai-sdk/provider-utils";
import { TypeValidationError, type ToolExecutionOptions, type ToolSet } from "ai";
import { ZodError } from "zod";

type RuntimeTool = ToolSet[string];

export function requireRuntimeTool(tools: Partial<ToolSet>, name: string) {
  const tool = tools[name];
  if (!tool || typeof tool.execute !== "function") {
    throw new Error(`Tool ${name} cannot be executed`);
  }
  const execute = tool.execute;

  return {
    execute: async (input: unknown, options: ToolExecutionOptions<unknown>): Promise<unknown> => {
      const parsed = await validateTypes({ value: input, schema: tool.inputSchema }).catch(
        (error: unknown) => {
          if (TypeValidationError.isInstance(error) && error.cause instanceof ZodError) {
            throw error.cause;
          }
          throw error;
        },
      );
      return await execute(parsed, options);
    },
    toModelOutput: tool.toModelOutput,
  } satisfies {
    execute: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>;
    toModelOutput: RuntimeTool["toModelOutput"];
  };
}
