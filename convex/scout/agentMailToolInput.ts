import { z } from "zod";

const MAX_EMAIL_ADDRESS_LENGTH = 320;
const MAX_EMAIL_SUBJECT_LENGTH = 200;
const MAX_EMAIL_TEXT_LENGTH = 20_000;
const MAX_MESSAGE_ID_LENGTH = 500;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emailTextSchema = z.string().trim().min(1).max(MAX_EMAIL_TEXT_LENGTH);

export const agentMailSendInputSchema = z.object({
  to: z
    .string()
    .trim()
    .min(1)
    .max(MAX_EMAIL_ADDRESS_LENGTH)
    .refine((value) => EMAIL_PATTERN.test(value), "Enter a valid recipient email address")
    .describe("The one recipient to email."),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(MAX_EMAIL_SUBJECT_LENGTH)
    .refine((value) => !/[\r\n]/.test(value), "Email subject must be one line"),
  text: emailTextSchema.describe("The plain-text email body."),
});

export const agentMailReplyInputSchema = z.object({
  messageId: z.string().trim().min(1).max(MAX_MESSAGE_ID_LENGTH),
  text: emailTextSchema.describe("The plain-text reply body."),
});
