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
};

describe("human handoff tool", () => {
  test("durably queues the handoff before pausing", async () => {
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
    const email = humanHandoffEmail({
      handoffId: "handoff-1",
      recipientEmail: "operator@example.test",
      scoutName: "Conrad Scout",
      handoffUrl,
      claimExpiresAt: Date.parse("2026-09-03T12:45:00.000Z"),
    });

    expect(email).toEqual({
      to: "operator@example.test",
      subject: "[Scout human check] Conrad Scout needs your help",
      text: expect.stringContaining(handoffUrl),
      idempotencyKey: "scout-handoff-handoff-1",
    });
    expect(email.text).toContain("before 2026-09-03T12:45:00.000Z");
    expect(email.text).toContain("starts a separate five-minute control window");
    expect(email.text).toContain("Do not reply to this email with passwords");
    expect(email.text).toContain("Sent by Conrad Scout from its Scout inbox");
    expect(email.text).not.toContain("attacker.test");
  });

  test("asks the model only for the visible blocker", () => {
    expect(humanHandoffInputSchema.safeParse(handoffInput).success).toBe(true);
    expect(humanHandoffInputSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(humanHandoffInputSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });
});
