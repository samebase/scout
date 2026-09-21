import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { sendEmail } from "./email";

const sendArgs = {
  to: "person@example.com",
  subject: "Verify your TrailScout email",
  text: "Verification code: 12345678",
};

function successfulResponse(permanentBounces: string[] = []) {
  return new Response(
    JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result: {
        delivered: permanentBounces.length === 0 ? ["person@example.com"] : [],
        permanent_bounces: permanentBounces,
        queued: [],
      },
    }),
    { status: 200 },
  );
}

function readRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body");
  }
  return JSON.parse(init.body);
}

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "account-id");
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "email-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Cloudflare email sending", () => {
  it("sends through the account-scoped REST endpoint", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      successfulResponse(),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(sendEmail(sendArgs)).resolves.toBeUndefined();

    const [input, init] = fetch.mock.calls[0];
    expect(input).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-id/email/sending/send",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer email-token",
        "Content-Type": "application/json",
      },
    });
    expect(readRequestBody(init)).toEqual({
      to: "person@example.com",
      from: {
        address: "scout-notifications@samebase.com",
        name: "TrailScout",
      },
      subject: "Verify your TrailScout email",
      text: "Verification code: 12345678",
    });
  });

  it("passes an abort signal to Cloudflare", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      successfulResponse(),
    );
    vi.stubGlobal("fetch", fetch);

    await sendEmail(sendArgs, { signal: controller.signal });

    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("requires both Cloudflare email settings", async () => {
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(sendEmail(sendArgs)).rejects.toThrow(
      "CLOUDFLARE_EMAIL_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN are required",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports API errors without exposing the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              errors: [
                {
                  code: 10001,
                  message: "email.sending.error.invalid_request_schema",
                },
              ],
              messages: [],
              result: null,
            }),
            { status: 400 },
          ),
      ),
    );

    const result = sendEmail(sendArgs).catch((error: unknown) => error);
    await expect(result).resolves.toMatchObject({
      message:
        "Cloudflare Email Sending failed (400): 10001: email.sending.error.invalid_request_schema",
    });
    await expect(result).resolves.not.toMatchObject({
      message: expect.stringContaining("email-token"),
    });
  });

  it("rejects permanent bounces", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => successfulResponse(["person@example.com"])),
    );

    await expect(sendEmail(sendArgs)).rejects.toThrow(
      "Cloudflare Email Sending permanently bounced for 1 recipient(s)",
    );
  });

  it("preserves the status for non-JSON failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Bad gateway", { status: 502 })),
    );

    await expect(sendEmail(sendArgs)).rejects.toThrow(
      "Cloudflare Email Sending returned a non-JSON response (502)",
    );
  });

  it("rejects malformed JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true, result: { delivered: [] } }), {
            status: 200,
          }),
      ),
    );

    await expect(sendEmail(sendArgs)).rejects.toThrow(
      "Cloudflare Email Sending returned an invalid response (200)",
    );
  });
});
