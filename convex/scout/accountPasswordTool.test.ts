import { describe, expect, it, vi } from "vite-plus/test";
import { createAccountPasswordFillTool, requirePasswordInputType } from "./accountPasswordTool";

const toolOptions = { toolCallId: "tool-1", messages: [], context: {} };

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

    await expect(
      passwordTool.execute({ passwordTarget, passwordConfirmationTarget }, toolOptions),
    ).resolves.toEqual({ filledFields: 2 });
    expect(fill).toHaveBeenCalledWith({ passwordTarget, passwordConfirmationTarget }, "tool-1");
  });

  it("rejects inputs that could carry plaintext instead of targets", async () => {
    const fill = vi.fn(async () => ({ filledFields: 1 }));
    const passwordTool = createAccountPasswordFillTool(fill);

    await expect(
      passwordTool.execute({ passwordTarget: "secret-password" } as never, toolOptions),
    ).rejects.toThrow();
    expect(fill).not.toHaveBeenCalled();
  });

  it("accepts only verified password input types", () => {
    expect(() => requirePasswordInputType(" password\n")).not.toThrow();
    expect(() => requirePasswordInputType("text")).toThrow("only be filled into password inputs");
    expect(() => requirePasswordInputType("")).toThrow("only be filled into password inputs");
  });
});
