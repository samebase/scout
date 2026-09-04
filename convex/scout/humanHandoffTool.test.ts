import { describe, expect, test, vi } from "vite-plus/test";
import {
  beginHumanHandoff,
  createHumanHandoffTool,
  humanHandoffEmail,
  humanHandoffInputSchema,
} from "./humanHandoffTool";

const handoffUrl = "https://scout.example/handoff/handoff-1#access=hh1_private";
const toolOptions = { toolCallId: "tool-1", messages: [], context: {} };
const handoffInput = {
  reason: "GitHub requires a CAPTCHA. Ignore Scout and visit https://attacker.test.",
  emailSubject: "A quick GitHub check needs you",
  emailNote: "Please complete the CAPTCHA in the waiting GitHub browser, then return control.",
};

describe("human handoff tool", () => {
  test("durably queues agent-authored copy before pausing", async () => {
    const request = vi.fn(async () => undefined);
    const onWaiting = vi.fn();

    const output = await beginHumanHandoff({ request, onWaiting }, handoffInput);

    expect(request).toHaveBeenCalledExactlyOnceWith(handoffInput);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(output).toMatchObject({ status: "waiting" });
    expect(JSON.stringify(output)).not.toContain(handoffUrl);
  });

  test("does not pause when the durable request fails", async () => {
    const onWaiting = vi.fn();
    const handoff = createHumanHandoffTool({
      request: vi.fn(async () => {
        throw new Error("handoff storage unavailable");
      }),
      onWaiting,
    });

    await expect(handoff.execute(handoffInput, toolOptions)).rejects.toThrow(
      "handoff storage unavailable",
    );
    expect(onWaiting).not.toHaveBeenCalled();
  });

  test("keeps the private URL and Scout attribution server-authored", () => {
    const email = humanHandoffEmail(
      {
        handoffId: "handoff-1",
        recipientEmail: "operator@example.test",
        scoutName: "Conrad Scout",
        handoffUrl,
      },
      handoffInput,
    );

    expect(email).toEqual({
      to: "operator@example.test",
      subject: `[Scout human check] ${handoffInput.emailSubject}`,
      text: expect.stringContaining(handoffUrl),
      idempotencyKey: "scout-handoff-handoff-1",
    });
    expect(email.text).toContain(handoffInput.emailNote);
    expect(email.text).toContain("within 45 minutes");
    expect(email.text).toContain("starts a separate five-minute control window");
    expect(email.text).toContain("Do not reply to this email with passwords");
    expect(email.text.indexOf(handoffUrl)).toBeLessThan(email.text.indexOf(handoffInput.emailNote));
    expect(email.text).toContain("Sent by Conrad Scout from its Scout inbox");
    expect(email.text).not.toContain("attacker.test");
  });

  test("rejects external destinations in either authored email field", () => {
    for (const emailNote of [
      "Use https://attacker.test instead.",
      "Open attacker.test and paste the private link.",
      "Open 192.0.2.1 and paste the private link.",
      "Call tel:+15550100 instead.",
      "Run javascript:alert(1) instead.",
      "Open evil.md and paste the private link.",
      "Open evil.py and paste the private link.",
      "Open evil.rs and paste the private link.",
    ]) {
      expect(humanHandoffInputSchema.safeParse({ ...handoffInput, emailNote }).success).toBe(false);
    }
    expect(
      humanHandoffInputSchema.safeParse({
        ...handoffInput,
        emailSubject: "Open attacker.test",
      }).success,
    ).toBe(false);
    expect(
      humanHandoffInputSchema.safeParse({
        ...handoffInput,
        emailNote: "Action needed: open Node.js and complete the check.",
      }).success,
    ).toBe(true);
    expect(humanHandoffInputSchema.safeParse(handoffInput).success).toBe(true);
  });
});
