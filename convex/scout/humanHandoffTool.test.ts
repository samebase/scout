import { describe, expect, test, vi } from "vite-plus/test";
import type { SendEmailArgs } from "../email";
import { createHumanHandoffTool } from "./humanHandoffTool";

const interactiveLiveViewUrl =
  "https://liveview.firecrawl.dev/private?signature=interactive-control";

function request(overrides: { created?: boolean } = {}) {
  return {
    handoffId: "handoff-1",
    created: overrides.created ?? true,
    recipientEmail: "operator@example.test",
    productName: "GitHub",
    scoutName: "Conrad Scout",
    interactiveLiveViewUrl,
    expiresAt: 10_000,
  };
}

const toolOptions = { toolCallId: "tool-1", messages: [], context: {} };

describe("human handoff tool", () => {
  test("emails the bound operator and resumes without exposing the takeover link to the model", async () => {
    const sendEmail = vi.fn(async (_args: SendEmailArgs) => undefined);
    const sleep = vi.fn(async () => undefined);
    const getStatus = vi
      .fn<() => Promise<"waiting" | "continued">>()
      .mockResolvedValueOnce("waiting")
      .mockResolvedValueOnce("continued");
    const handoff = createHumanHandoffTool(
      {
        request: vi.fn(async () => request()),
        getStatus,
        expire: vi.fn(async () => "expired" as const),
      },
      { sendEmail, sleep, now: () => 1_000 },
    );

    const output = await handoff.execute({ reason: "GitHub requires a CAPTCHA." }, toolOptions);

    expect(sendEmail).toHaveBeenCalledWith({
      to: "operator@example.test",
      subject: "Conrad Scout needs help with GitHub",
      text: expect.stringContaining(interactiveLiveViewUrl),
    });
    const email = sendEmail.mock.calls[0]?.[0];
    expect(email?.text).toContain("five minutes");
    expect(email?.text).toContain("desktop computer");
    expect(email?.text).toContain("Mobile drag controls may be unreliable");
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(output).toMatchObject({ resumed: true });
    expect(JSON.stringify(output)).not.toContain("liveview.firecrawl.dev");
  });

  test("does not send a duplicate email for an existing waiting request", async () => {
    const sendEmail = vi.fn(async () => undefined);
    const handoff = createHumanHandoffTool(
      {
        request: vi.fn(async () => request({ created: false })),
        getStatus: vi.fn(async () => "continued" as const),
        expire: vi.fn(async () => "expired" as const),
      },
      { sendEmail, sleep: vi.fn(async () => undefined), now: () => 1_000 },
    );

    await expect(
      handoff.execute({ reason: "GitHub requires a CAPTCHA." }, toolOptions),
    ).resolves.toMatchObject({ resumed: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("expires the request before surfacing an email delivery failure", async () => {
    const expiration = vi.fn(async () => "expired" as const);
    const handoff = createHumanHandoffTool(
      {
        request: vi.fn(async () => request()),
        getStatus: vi.fn(async () => "waiting" as const),
        expire: expiration,
      },
      {
        sendEmail: vi.fn(async () => {
          throw new Error("mail provider unavailable");
        }),
        sleep: vi.fn(async () => undefined),
        now: () => 1_000,
      },
    );

    await expect(
      handoff.execute({ reason: "GitHub requires a CAPTCHA." }, toolOptions),
    ).rejects.toThrow("could not email");
    expect(expiration).toHaveBeenCalledWith("handoff-1");
  });

  test("keeps the Attempt active after the request expires", async () => {
    const output = await createHumanHandoffTool(
      {
        request: vi.fn(async () => request()),
        getStatus: vi.fn(async () => "expired" as const),
        expire: vi.fn(async () => "expired" as const),
      },
      {
        sendEmail: vi.fn(async () => undefined),
        sleep: vi.fn(async () => undefined),
        now: () => 1_000,
      },
    ).execute({ reason: "GitHub requires a CAPTCHA." }, toolOptions);

    expect(output).toMatchObject({ resumed: false });
    expect(JSON.stringify(output)).not.toContain(interactiveLiveViewUrl);
    expect(JSON.stringify(output)).toContain("still-active attempt");
    expect(JSON.stringify(output)).not.toContain("Inconclusive");
  });

  test("observes a continuation committed before the final atomic expiry", async () => {
    let now = 9_000;
    const expire = vi.fn(async () => "continued" as const);
    const getStatus = vi.fn(async () => "waiting" as const);
    const handoff = createHumanHandoffTool(
      {
        request: vi.fn(async () => request()),
        getStatus,
        expire,
      },
      {
        sendEmail: vi.fn(async () => undefined),
        sleep: vi.fn(async (milliseconds) => {
          now += milliseconds;
        }),
        now: () => now,
      },
    );

    await expect(
      handoff.execute({ reason: "GitHub requires a CAPTCHA." }, toolOptions),
    ).resolves.toMatchObject({ resumed: true });
    expect(getStatus).toHaveBeenCalledOnce();
    expect(expire).toHaveBeenCalledWith("handoff-1");
  });
});
