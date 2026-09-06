import { validateTypes } from "@ai-sdk/provider-utils";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createAccountPasswordFillTool,
  createAccountPasswordPreparationTool,
  requirePasswordInputType,
} from "./accountPasswordTool";

const abortSignal = new AbortController().signal;
const toolOptions = { toolCallId: "tool-1", messages: [], context: {}, abortSignal };

describe("Scout account password tool", () => {
  it.each(["scoutId", "sessionId", "credentialHost", "password"])(
    "rejects model-supplied preparation scope or secrets: %s",
    async (field) => {
      const prepare = vi.fn(async () => ({
        serviceAccountId: "account-1",
        credentialHost: "example.com",
      }));
      const passwordTool = createAccountPasswordPreparationTool(prepare);
      await expect(
        validateTypes({
          value: {
            serviceName: "Example",
            serviceDomain: "example.com",
            identifier: "magda@example.test",
            [field]: "untrusted",
          },
          schema: passwordTool.inputSchema,
        }),
      ).rejects.toThrow();
      expect(prepare).not.toHaveBeenCalled();
    },
  );

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

  it("accepts a CSS target for an unlabeled password field without extra arguments", async () => {
    const fill = vi.fn(async () => ({ filledFields: 1 }));
    const passwordTool = createAccountPasswordFillTool(fill);
    const passwordTarget = { kind: "css", selector: 'input[name="password"]' } as const;
    const input = await validateTypes({
      value: { passwordTarget },
      schema: passwordTool.inputSchema,
    });

    await expect(passwordTool.execute(input, toolOptions)).resolves.toEqual({ filledFields: 1 });
    expect(fill).toHaveBeenCalledWith({ passwordTarget }, "tool-1", abortSignal);
  });

  it("rejects CSS targets that enter another frame outside the verified login page", async () => {
    const fill = vi.fn(async () => ({ filledFields: 1 }));
    const passwordTool = createAccountPasswordFillTool(fill);
    await expect(
      validateTypes({
        value: {
          passwordTarget: {
            kind: "css",
            selector: 'iframe >> internal:control=enter-frame >> input[type="password"]',
          },
        },
        schema: passwordTool.inputSchema,
      }),
    ).rejects.toThrow("without Playwright selector chaining");
    expect(fill).not.toHaveBeenCalled();
  });

  it("accepts only verified password input types", () => {
    expect(() => requirePasswordInputType(" password\n")).not.toThrow();
    expect(() => requirePasswordInputType("text")).toThrow("only be filled into password inputs");
    expect(() => requirePasswordInputType("")).toThrow("only be filled into password inputs");
  });
});
