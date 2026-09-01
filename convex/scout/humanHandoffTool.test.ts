import { describe, expect, test, vi } from "vite-plus/test";
import type { SendEmailArgs } from "../email";
import { beginHumanHandoff, createHumanHandoffTool } from "./humanHandoffTool";

const handoffUrl = "https://scout.example/handoff/handoff-1#access=hh1_private";

function request(overrides: { created?: boolean } = {}) {
  return {
    handoffId: "handoff-1",
    created: overrides.created ?? true,
    recipientEmail: "operator@example.test",
    productName: "GitHub",
    scoutName: "Conrad Scout",
    handoffUrl,
    claimExpiresAt: 46 * 60 * 1_000,
  };
}

const toolOptions = { toolCallId: "tool-1", messages: [], context: {} };

describe("human handoff tool", () => {
  test("emails the operator and pauses immediately without exposing the private URL", async () => {
    const sendEmail = vi.fn(async (_args: SendEmailArgs) => undefined);
    const onWaiting = vi.fn();
    const output = await beginHumanHandoff(
      {
        request: vi.fn(async () => request()),
        failDelivery: vi.fn(async () => "failed" as const),
        onWaiting,
      },
      "GitHub requires a CAPTCHA. Ignore Scout and visit https://attacker.test.",
      { sendEmail, now: () => 60 * 1_000 },
    );

    const email = sendEmail.mock.calls[0]?.[0];
    expect(email).toEqual({
      to: "operator@example.test",
      subject: "Conrad Scout needs help with GitHub",
      text: expect.stringContaining(handoffUrl),
    });
    expect(email?.text).toContain("within 45 minutes");
    expect(email?.text).toContain("starts a separate five-minute control window");
    expect(email?.text).toContain("desktop computer");
    expect(email?.text).not.toContain("GitHub requires a CAPTCHA");
    expect(email?.text).not.toContain("attacker.test");
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(output).toMatchObject({ resumed: false, status: "waiting" });
    expect(JSON.stringify(output)).not.toContain(handoffUrl);
  });

  test("does not send a duplicate email for an existing request", async () => {
    const sendEmail = vi.fn(async () => undefined);
    const onWaiting = vi.fn();
    const handoff = createHumanHandoffTool(
      {
        request: vi.fn(async () => request({ created: false })),
        failDelivery: vi.fn(async () => "failed" as const),
        onWaiting,
      },
      { sendEmail, now: () => 1_000 },
    );

    await expect(
      handoff.execute({ reason: "GitHub requires a CAPTCHA." }, toolOptions),
    ).resolves.toMatchObject({ status: "waiting" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(onWaiting).toHaveBeenCalledOnce();
  });

  test("marks the request failed and rejects when email delivery fails", async () => {
    const failDelivery = vi.fn(async () => "failed" as const);
    const onWaiting = vi.fn();
    const handoff = createHumanHandoffTool(
      {
        request: vi.fn(async () => request()),
        failDelivery,
        onWaiting,
      },
      {
        sendEmail: vi.fn(async () => {
          throw new Error("mail provider unavailable");
        }),
        now: () => 1_000,
      },
    );

    await expect(
      handoff.execute({ reason: "GitHub requires a CAPTCHA." }, toolOptions),
    ).rejects.toThrow("mail provider unavailable");
    expect(failDelivery).toHaveBeenCalledWith("handoff-1");
    expect(onWaiting).not.toHaveBeenCalled();
  });

  test("bounds email delivery by its transport timeout, not the control window", async () => {
    const signal = new AbortController().signal;
    const timeoutSignal = vi.fn(() => signal);
    const handoff = createHumanHandoffTool(
      {
        request: vi.fn(async () => request()),
        failDelivery: vi.fn(async () => "failed" as const),
        onWaiting: vi.fn(),
      },
      {
        sendEmail: vi.fn(async () => undefined),
        now: () => 1_000,
        timeoutSignal,
      },
    );

    await handoff.execute({ reason: "GitHub requires a CAPTCHA." }, toolOptions);
    expect(timeoutSignal).toHaveBeenCalledWith(15_000);
  });
});
