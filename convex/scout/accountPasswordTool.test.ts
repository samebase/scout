import { validateTypes } from "@ai-sdk/provider-utils";
import { describe, expect, it, vi } from "vite-plus/test";
import { createAccountPasswordFillTool, requirePasswordInputType } from "./accountPasswordTool";

const abortSignal = new AbortController().signal;
const toolOptions = { toolCallId: "tool-1", messages: [], context: {}, abortSignal };

describe("Scout account password tool", () => {
  it("passes only password targets to the trusted filler", async () => {
    const fill = vi.fn(async () => ({ filledFields: 2 }));
    const passwordTool = createAccountPasswordFillTool(fill);
    const passwordTarget = {
      kind: "label" as const,
      text: "Password",
      exact: true,
    };
    const passwordConfirmationTarget = {
      kind: "label" as const,
      text: "Confirm password",
      exact: true,
    };

    const input = await validateTypes({
      value: { passwordTarget, passwordConfirmationTarget },
      schema: passwordTool.inputSchema,
    });

    await expect(passwordTool.execute(input, toolOptions)).resolves.toEqual({ filledFields: 2 });
    expect(fill).toHaveBeenCalledWith(
      { passwordTarget, passwordConfirmationTarget },
      "tool-1",
      abortSignal,
    );
  });

  it("rejects inputs that could carry plaintext instead of targets", async () => {
    const fill = vi.fn(async () => ({ filledFields: 1 }));
    const passwordTool = createAccountPasswordFillTool(fill);

    await expect(
      validateTypes({
        value: { passwordTarget: "secret-password" },
        schema: passwordTool.inputSchema,
      }),
    ).rejects.toThrow();
    expect(fill).not.toHaveBeenCalled();
  });

  it("accepts only verified password input types", () => {
    expect(() => requirePasswordInputType(" password\n")).not.toThrow();
    expect(() => requirePasswordInputType("text")).toThrow("only be filled into password inputs");
    expect(() => requirePasswordInputType("")).toThrow("only be filled into password inputs");
  });
});
