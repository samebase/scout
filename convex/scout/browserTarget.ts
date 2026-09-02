import { z } from "zod";

export const browserRoles = [
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "option",
  "radio",
  "switch",
  "tab",
  "textbox",
] as const;

export const browserTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("role"),
      role: z.enum(browserRoles),
      name: z.string().min(1).max(1_000),
      exact: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("label"),
      text: z.string().min(1).max(1_000),
      exact: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      text: z.string().min(1).max(1_000),
      exact: z.boolean().default(true),
    })
    .strict(),
]);

export type BrowserTarget = z.infer<typeof browserTargetSchema>;
