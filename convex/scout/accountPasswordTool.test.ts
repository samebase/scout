import { describe, expect, it, vi } from "vite-plus/test";
import { createAccountPasswordFillTool, requirePasswordInputType } from "./accountPasswordTool";

const toolOptions = { toolCallId: "tool-1", messages: [], context: {} };

describe("Scout account password tool", () => {
  it("passes only password element refs to the trusted filler", async () => {
    const fill = vi.fn(async () => ({ filledFields: 2 }));
    const passwordTool = createAccountPasswordFillTool(fill);

    await expect(
      passwordTool.execute({ passwordRef: "@e3", passwordConfirmationRef: "@e4" }, toolOptions),
    ).resolves.toEqual({ filledFields: 2 });
    expect(fill).toHaveBeenCalledWith({
      passwordRef: "@e3",
      passwordConfirmationRef: "@e4",
    });
  });

  it("rejects inputs that could carry plaintext instead of element refs", async () => {
    const fill = vi.fn(async () => ({ filledFields: 1 }));
    const passwordTool = createAccountPasswordFillTool(fill);

    await expect(
      passwordTool.execute({ passwordRef: "secret-password" }, toolOptions),
    ).rejects.toThrow();
    expect(fill).not.toHaveBeenCalled();
  });

  it("accepts only verified password input types", () => {
    expect(() => requirePasswordInputType(" password\n")).not.toThrow();
    expect(() => requirePasswordInputType("text")).toThrow("only be filled into password inputs");
    expect(() => requirePasswordInputType("")).toThrow("only be filled into password inputs");
  });
});
