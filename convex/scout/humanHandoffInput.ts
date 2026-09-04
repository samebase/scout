import { z } from "zod";

const MAX_HANDOFF_REASON_LENGTH = 500;
const MAX_HANDOFF_EMAIL_SUBJECT_LENGTH = 120;
const MAX_HANDOFF_EMAIL_NOTE_LENGTH = 1_200;
const EXPLICIT_URL_PATTERN =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:data|javascript|mailto|sms|tel):|\bwww\.)/i;
const IPV4_ADDRESS_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const LOCALHOST_PATTERN = /\blocalhost(?::\d{1,5})?\b/i;
const DOTTED_NAME_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63})\b/gi;
const NON_DOMAIN_FILE_SUFFIXES = new Set([
  "css",
  "go",
  "java",
  "js",
  "json",
  "jsx",
  "rb",
  "toml",
  "ts",
  "tsx",
  "yaml",
  "yml",
]);

function containsExternalDestination(value: string) {
  if (
    EXPLICIT_URL_PATTERN.test(value) ||
    IPV4_ADDRESS_PATTERN.test(value) ||
    LOCALHOST_PATTERN.test(value)
  ) {
    return true;
  }
  for (const match of value.matchAll(DOTTED_NAME_PATTERN)) {
    const suffix = match[1];
    if (suffix && !NON_DOMAIN_FILE_SUFFIXES.has(suffix.toLowerCase())) return true;
  }
  return false;
}

function emailCopySchema(maximumLength: number, label: string) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximumLength)
    .refine((value) => !containsExternalDestination(value), `${label} must not contain a URL`);
}

export const humanHandoffInputSchema = z.object({
  reason: z.string().trim().min(1).max(MAX_HANDOFF_REASON_LENGTH),
  emailSubject: emailCopySchema(
    MAX_HANDOFF_EMAIL_SUBJECT_LENGTH,
    "The human-help email subject",
  ).describe("A concise subject for the human operator."),
  emailNote: emailCopySchema(MAX_HANDOFF_EMAIL_NOTE_LENGTH, "The human-help email note").describe(
    "A concise explanation of what you need the operator to do. Do not include a link; Scout adds the private handoff link.",
  ),
});

export type HumanHandoffInput = z.output<typeof humanHandoffInputSchema>;
