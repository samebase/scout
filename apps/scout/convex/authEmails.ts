import { Email } from "@convex-dev/auth/providers/Email";
import { normalizeAuthEmail } from "./authEmail";
import { sendEmail } from "./email";
import { EMAIL_VERIFICATION_PROVIDER_ID, PASSWORD_RESET_PROVIDER_ID } from "../shared/auth";

const CODE_LENGTH = 8;
const CODE_TTL_SECONDS = 15 * 60;
const AUTH_EMAIL_FROM = "Scout <scout-notifications@samebase.com>";
const DECIMAL_BUCKET_SIZE = 250;

function generateNumericCode() {
  let code = "";

  while (code.length < CODE_LENGTH) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH - code.length));
    for (const byte of randomBytes) {
      if (byte < DECIMAL_BUCKET_SIZE) {
        code += String(byte % 10);
      }
    }
  }

  return code;
}

function createEmailCodeProvider({
  id,
  subject,
  message,
}: {
  id: typeof EMAIL_VERIFICATION_PROVIDER_ID | typeof PASSWORD_RESET_PROVIDER_ID;
  subject: string;
  message: string;
}) {
  const provider = {
    id,
    from: AUTH_EMAIL_FROM,
    maxAge: CODE_TTL_SECONDS,
    normalizeIdentifier: normalizeAuthEmail,
    generateVerificationToken: async () => generateNumericCode(),
    async sendVerificationRequest({
      identifier: email,
      token,
    }: Parameters<ReturnType<typeof Email>["sendVerificationRequest"]>[0]) {
      await sendEmail({
        to: email,
        subject,
        text: `${message}\n\n${token}\n\nThis code expires in 15 minutes. If you did not request it, you can ignore this email.`,
        html: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;"><h1 style="font-size: 24px; margin: 0 0 16px;">Scout</h1><p>${message}</p><p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; margin: 24px 0;">${token}</p><p>This code expires in 15 minutes.</p><p style="color: #6b7280; font-size: 14px;">If you did not request it, you can ignore this email.</p></div>`,
      });
    },
  };
  return { ...Email(provider), options: provider };
}

export const emailVerificationCode = createEmailCodeProvider({
  id: EMAIL_VERIFICATION_PROVIDER_ID,
  subject: "Verify your Scout email",
  message: "Enter this code in Scout to verify your email address:",
});

export const passwordResetCode = createEmailCodeProvider({
  id: PASSWORD_RESET_PROVIDER_ID,
  subject: "Reset your Scout password",
  message: "Enter this code in Scout to choose a new password:",
});
