import { env } from "./_generated/server";
import { omitNullish } from "../shared/omitNullish";

const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const EMAIL_FROM = {
  address: "scout-notifications@samebase.com",
  name: "TrailScout",
};

type EmailContent = { text: string; html?: string } | { text?: string; html: string };

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
} & EmailContent;

export type SendEmailOptions = {
  signal?: AbortSignal;
};

type CloudflareEmailResponse =
  | { kind: "accepted"; permanentBounces: string[] }
  | { kind: "rejected"; errors: { code: string | number; message: string }[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function parseCloudflareEmailResponse(payload: unknown): CloudflareEmailResponse | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (payload["success"] === true) {
    const result = payload["result"];
    if (!isRecord(result)) {
      return null;
    }

    const delivered = readStringArray(result["delivered"]);
    const permanentBounces = readStringArray(result["permanent_bounces"]);
    const queued = readStringArray(result["queued"]);
    if (!delivered || !permanentBounces || !queued) {
      return null;
    }

    return { kind: "accepted", permanentBounces };
  }

  if (payload["success"] === false && Array.isArray(payload["errors"])) {
    const errors: { code: string | number; message: string }[] = [];
    for (const error of payload["errors"]) {
      if (!isRecord(error)) {
        return null;
      }
      const code = error["code"];
      const message = error["message"];
      if ((typeof code !== "string" && typeof code !== "number") || typeof message !== "string") {
        return null;
      }
      errors.push({ code, message });
    }
    return { kind: "rejected", errors };
  }

  return null;
}

export async function sendEmail(
  args: SendEmailArgs,
  options: SendEmailOptions = {},
): Promise<void> {
  const accountId = env.CLOUDFLARE_EMAIL_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();

  if (!accountId || !token) {
    throw new Error(
      "CLOUDFLARE_EMAIL_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN are required for email sending.",
    );
  }

  const response = await fetch(
    `${CLOUDFLARE_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: args.to,
        from: EMAIL_FROM,
        subject: args.subject,
        text: args.text,
        html: args.html,
      }),
      ...omitNullish({ signal: options.signal }),
    },
  );

  const responseText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(`Cloudflare Email Sending returned a non-JSON response (${response.status}).`);
  }

  const result = parseCloudflareEmailResponse(payload);
  if (!result) {
    throw new Error(`Cloudflare Email Sending returned an invalid response (${response.status}).`);
  }
  if (result.kind === "rejected") {
    const details = result.errors.map((error) => `${error.code}: ${error.message}`).join("; ");
    throw new Error(
      `Cloudflare Email Sending failed (${response.status})${details ? `: ${details}` : "."}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Cloudflare Email Sending failed (${response.status}).`);
  }
  if (result.permanentBounces.length > 0) {
    throw new Error(
      `Cloudflare Email Sending permanently bounced for ${result.permanentBounces.length} recipient(s).`,
    );
  }
}
