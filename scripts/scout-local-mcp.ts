import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  manualToolResultSchema,
  mcpBridgeToolCallSchema,
  runnerContextSchema,
  type RunnerContext,
} from "../src/lib/scoutRunnerProtocol.ts";

const objectInputSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.object({}).loose()).optional(),
    required: z.array(z.string()).optional(),
  })
  .loose();
const objectUnionInputSchema = z.object({ oneOf: z.array(objectInputSchema).min(1) }).loose();
const bridgeErrorSchema = z.object({ error: z.string() });

function parseMcpInputSchema(input: unknown) {
  const objectSchema = objectInputSchema.safeParse(input);
  if (objectSchema.success) return objectSchema.data;

  const unionSchema = objectUnionInputSchema.parse(input);
  return objectInputSchema.parse({ ...unionSchema, type: "object" });
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function loadContext(path: string) {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  return runnerContextSchema.parse(raw);
}

function mcpTools(context: RunnerContext) {
  return context.tools.map(
    (tool): Tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: parseMcpInputSchema(tool.inputSchema),
      annotations: {
        readOnlyHint:
          tool.name === "web_search" ||
          tool.name === "web_read" ||
          tool.name === "list_messages" ||
          tool.name === "search_messages" ||
          tool.name === "get_thread",
        destructiveHint: false,
        idempotentHint: tool.name === "browser_close",
        openWorldHint: true,
      },
    }),
  );
}

async function callScoutTool({
  runnerUrl,
  secret,
  context,
  name,
  input,
}: {
  runnerUrl: string;
  secret: string;
  context: RunnerContext;
  name: string;
  input: unknown;
}) {
  const toolCall = mcpBridgeToolCallSchema.safeParse({
    threadId: context.threadId,
    toolName: name,
    input,
  });
  if (!toolCall.success || !context.tools.some((tool) => tool.name === toolCall.data.toolName)) {
    throw new Error(`Scout tool ${name} is unavailable`);
  }
  const response = await fetch(new URL("/api/tool-call", runnerUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(toolCall.data),
    signal: AbortSignal.timeout(120_000),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const parsedError = bridgeErrorSchema.safeParse(value);
    const message = parsedError.success
      ? parsedError.data.error
      : `Runner bridge returned status ${response.status}`;
    throw new Error(message);
  }
  return manualToolResultSchema.parse(value);
}

async function main() {
  const runnerUrl = requiredEnvironment("SCOUT_RUNNER_URL");
  const secret = requiredEnvironment("SCOUT_RUNNER_SECRET");
  const context = await loadContext(requiredEnvironment("SCOUT_MCP_CONTEXT_PATH"));
  const tools = mcpTools(context);
  const server = new Server(
    { name: "scout", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: `${context.instructions}\n\nUse only the tools from this Scout server.`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await callScoutTool({
        runnerUrl,
        secret,
        context,
        name: request.params.name,
        input: request.params.arguments ?? {},
      });
      if (result.outcome.kind === "error") {
        return {
          isError: true,
          content: [{ type: "text", text: result.outcome.error }],
        };
      }
      return {
        content: [{ type: "text", text: result.outcome.output }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "Scout tool call failed",
          },
        ],
      };
    }
  });

  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Scout MCP failed"}\n`);
  process.exitCode = 1;
});
