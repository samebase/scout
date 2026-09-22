import { type Infer, v } from "convex/values";

export const taskEngine = v.union(v.literal("agents_api"), v.literal("convex_agent"));
export const convexTaskModel = v.union(
  v.literal("gpt-5.6-luna"),
  v.literal("qwen/qwen3.7-flash"),
  v.literal("deepseek/deepseek-v4-flash-0731"),
);
export const taskSelection = v.union(
  v.object({ engine: v.literal("agents_api"), model: v.literal("gpt-5.6-luna") }),
  v.object({ engine: v.literal("convex_agent"), model: convexTaskModel }),
);
export type TaskSelection = Infer<typeof taskSelection>;

export const defaultTaskSelection = {
  engine: "convex_agent",
  model: "gpt-5.6-luna",
} satisfies TaskSelection;

export const agentsApiPauseLabel = "Temporarily disabled due to OpenAI billing issues.";

export function taskEngineDisabledReason(
  engine: Infer<typeof taskEngine>,
  agentsApiEnabled: boolean,
): string | null {
  return engine === "agents_api" && !agentsApiEnabled
    ? `${agentsApiPauseLabel} Start a new task with Luna - Convex.`
    : null;
}

export const taskModelOptions = [
  {
    value: "agents_api",
    label: "Luna - Agents API",
    selection: { engine: "agents_api", model: "gpt-5.6-luna" },
  },
  {
    value: "convex_agent",
    label: "Luna - Convex",
    selection: { engine: "convex_agent", model: "gpt-5.6-luna" },
  },
  {
    value: "qwen/qwen3.7-flash",
    label: "Qwen 3.7 Flash",
    selection: { engine: "convex_agent", model: "qwen/qwen3.7-flash" },
  },
  {
    value: "deepseek/deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash",
    selection: { engine: "convex_agent", model: "deepseek/deepseek-v4-flash-0731" },
  },
] satisfies { value: string; label: string; selection: TaskSelection }[];
