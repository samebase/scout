import { InvalidToolInputError, type ToolCallRepairFunction, type ToolSet } from "ai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectsString(schema: unknown): boolean {
  if (schema === false) return true;
  if (!isRecord(schema)) return false;

  const type = schema["type"];
  if (typeof type === "string" || Array.isArray(type)) {
    const types = Array.isArray(type) ? type : [type];
    return !types.includes("string");
  }
  if (schema["const"] !== undefined) return typeof schema["const"] !== "string";
  const values = schema["enum"];
  if (Array.isArray(values)) return values.every((value: unknown) => typeof value !== "string");
  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf)) return oneOf.every(rejectsString);
  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf)) return anyOf.every(rejectsString);
  const allOf = schema["allOf"];
  if (Array.isArray(allOf)) return allOf.some(rejectsString);
  return false;
}

function parseJson(value: string) {
  try {
    return { success: true as const, value: JSON.parse(value) as unknown };
  } catch {
    return { success: false as const };
  }
}

export function repairStringifiedTopLevelValues(input: unknown, schema: unknown) {
  if (!isRecord(input) || !isRecord(schema)) return null;
  const properties = schema["properties"];
  if (!isRecord(properties)) return null;

  let changed = false;
  const repaired: Record<string, unknown> = { ...input };
  for (const [name, value] of Object.entries(input)) {
    if (typeof value !== "string" || !rejectsString(properties[name])) continue;
    const parsed = parseJson(value);
    if (!parsed.success || typeof parsed.value === "string") continue;
    repaired[name] = parsed.value;
    changed = true;
  }
  return changed ? repaired : null;
}

export const repairStringifiedToolInput: ToolCallRepairFunction<ToolSet> = async ({
  error,
  inputSchema,
  toolCall,
}) => {
  if (!InvalidToolInputError.isInstance(error)) return null;
  const parsedInput = parseJson(toolCall.input);
  if (!parsedInput.success) return null;
  const repairedInput = repairStringifiedTopLevelValues(
    parsedInput.value,
    await inputSchema({ toolName: toolCall.toolName }),
  );
  return repairedInput === null
    ? null
    : {
        ...toolCall,
        input: JSON.stringify(repairedInput),
      };
};
