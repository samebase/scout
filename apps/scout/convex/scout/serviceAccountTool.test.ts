import { validateTypes } from "@ai-sdk/provider-utils";
import { describe, expect, it, vi } from "vite-plus/test";
import { createServiceAccountRecordingTool } from "./serviceAccountTool";

const abortSignal = new AbortController().signal;
const toolOptions = { toolCallId: "tool-1", messages: [], context: {}, abortSignal };

describe("Scout service-account recording tool", () => {
  it("records email-code sign-in without a password or OAuth provider", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "notion-account", created: true }));
    const recordingTool = createServiceAccountRecordingTool(record);
    const input = await validateTypes({
      value: {
        accountAccess: "created",
        loginMethod: "passwordless",
        identifier: "john@eggfit.com",
        verification:
          "Notion account settings shows John and john@eggfit.com after email verification.",
      },
      schema: recordingTool.inputSchema,
    });
    await recordingTool.execute(input, toolOptions);
    expect(record).toHaveBeenCalledWith(
      { ...input, loginMethod: { kind: "passwordless" } },
      abortSignal,
    );
  });

  it.each([undefined, "", "   "])(
    "requires a verification explanation (%s)",
    async (verification) => {
      const record = vi.fn(async () => ({ serviceAccountId: "trello-account", created: false }));
      const recordingTool = createServiceAccountRecordingTool(record);
      await expect(
        validateTypes({
          value: {
            accountAccess: "created",
            loginMethod: "managed_password",
            identifier: "conrad@example.test",
            verification,
          },
          schema: recordingTool.inputSchema,
        }),
      ).rejects.toThrow();
      expect(record).not.toHaveBeenCalled();
    },
  );
  it("records a saved login without page text selectors", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: false }));
    const recordingTool = createServiceAccountRecordingTool(record);

    const input = await validateTypes({
      value: {
        accountAccess: "created",
        verification: "Account settings shows the Scout identity after completed sign-in.",
        loginMethod: "managed_password",
        identifier: "conrad@example.test",
      },
      schema: recordingTool.inputSchema,
    });

    await expect(recordingTool.execute(input, toolOptions)).resolves.toEqual({
      serviceAccountId: "account-1",
      created: false,
    });
    expect(record).toHaveBeenCalledWith(
      {
        accountAccess: "created",
        verification: "Account settings shows the Scout identity after completed sign-in.",
        loginMethod: { kind: "managed_password" },
        identifier: "conrad@example.test",
      },
      abortSignal,
    );
  });

  it.each(["serviceAccountId", "scoutId", "sessionId", "serviceDomain", "observedUrl"])(
    "rejects model-supplied account or browser scope: %s",
    async (field) => {
      const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: false }));
      const recordingTool = createServiceAccountRecordingTool(record);
      const invalidInput: {
        accountAccess: "created";
        loginMethod: "managed_password";
        identifier: string;
        [field: string]: string;
      } = {
        accountAccess: "created",
        verification: "Account settings shows the Scout identity after completed sign-in.",
        loginMethod: "managed_password",
        identifier: "conrad@example.test",
        [field]: "other@example.test",
      };

      await expect(
        validateTypes({ value: invalidInput, schema: recordingTool.inputSchema }),
      ).rejects.toThrow();
      expect(record).not.toHaveBeenCalled();
    },
  );

  it("passes an exact OAuth provider account identity to trusted code", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: true }));
    const recordingTool = createServiceAccountRecordingTool(record);

    const input = await validateTypes({
      value: {
        accountAccess: "created",
        verification: "Account settings shows the Scout identity after completed sign-in.",
        loginMethod: "oauth",
        oauthProviderServiceDomain: "github.com",
        oauthProviderIdentifier: "conrad-scout",
        identifier: "conrad@example.test",
      },
      schema: recordingTool.inputSchema,
    });

    await recordingTool.execute(input, toolOptions);

    expect(record).toHaveBeenCalledWith(
      {
        accountAccess: "created",
        verification: "Account settings shows the Scout identity after completed sign-in.",
        loginMethod: {
          kind: "oauth",
          providerServiceDomain: "github.com",
          providerIdentifier: "conrad-scout",
        },
        identifier: "conrad@example.test",
      },
      abortSignal,
    );
  });

  it("requires an exact provider account for OAuth", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: true }));
    const recordingTool = createServiceAccountRecordingTool(record);

    await expect(
      validateTypes({
        value: {
          accountAccess: "created",
          verification: "Account settings shows the Scout identity after completed sign-in.",
          loginMethod: "oauth",
          identifier: "conrad@example.test",
        },
        schema: recordingTool.inputSchema,
      }),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });
});
