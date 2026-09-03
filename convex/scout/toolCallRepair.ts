import { InvalidToolInputError, type ToolCallRepairFunction, type ToolSet } from "ai";
import { z } from "zod";

const unknownRecordSchema = z.record(z.string(), z.unknown());
const toolInputSchemaShape = z.object({ properties: unknownRecordSchema });
const jsonSchemaShape = z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  const: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
  oneOf: z.array(z.unknown()).optional(),
  anyOf: z.array(z.unknown()).optional(),
  allOf: z.array(z.unknown()).optional(),
});
const jsonValueSchema = z.json();

function rejectsString(schema: unknown): boolean {
  if (schema === false) return true;
  const parsed = jsonSchemaShape.safeParse(schema);
  if (!parsed.success) return false;

  const { type } = parsed.data;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    return !types.includes("string");
  }
  if (parsed.data.const !== undefined) return typeof parsed.data.const !== "string";
  if (parsed.data.enum) {
    return parsed.data.enum.every((value) => typeof value !== "string");
  }
  if (parsed.data.oneOf) return parsed.data.oneOf.every(rejectsString);
  if (parsed.data.anyOf) return parsed.data.anyOf.every(rejectsString);
  if (parsed.data.allOf) return parsed.data.allOf.some(rejectsString);
  return false;
}

function parseJson(value: string) {
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(value));
    return parsed.success
      ? { success: true as const, value: parsed.data }
      : { success: false as const };
  } catch {
    return { success: false as const };
  }
}

export function repairStringifiedTopLevelValues(input: unknown, schema: unknown) {
  const parsedInput = unknownRecordSchema.safeParse(input);
  const parsedSchema = toolInputSchemaShape.safeParse(schema);
  if (!parsedInput.success || !parsedSchema.success) return null;

  const fields: string[] = [];
  const repaired = { ...parsedInput.data };
  for (const [name, value] of Object.entries(parsedInput.data)) {
    if (typeof value !== "string" || !rejectsString(parsedSchema.data.properties[name])) continue;
    const parsed = parseJson(value);
    if (!parsed.success || typeof parsed.value === "string") continue;
    repaired[name] = parsed.value;
    fields.push(name);
  }
  return fields.length > 0 ? { input: repaired, fields } : null;
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
        input: JSON.stringify(repairedInput.input),
        providerMetadata: {
          ...toolCall.providerMetadata,
          scout: {
            ...toolCall.providerMetadata?.["scout"],
            inputRepair: {
              method: "json-parse",
              fields: repairedInput.fields,
            },
          },
        },
      };
};
