import { validateTypes } from "@ai-sdk/provider-utils";
import { describe, expect, it, vi } from "vite-plus/test";
import { requireRuntimeTool } from "./lib/runtimeTool";
import { createServiceAccountRecordingTool } from "./serviceAccountTool";

const abortSignal = new AbortController().signal;
const toolOptions = { toolCallId: "tool-1", messages: [], context: {}, abortSignal };

describe("Scout service-account recording tool", () => {
  describe.each(["Agents API", "Convex Agent"])("%s execution", (engine) => {
    it.each(["managed_password", "passwordless", "oauth"] as const)(
      "records %s evidence from persisted tool input",
      async (loginMethod) => {
        const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: true }));
        const recordingTool = createServiceAccountRecordingTool(record);
        const input = {
          accountAccess: "recovered",
          identifier: "john@eggfit.com",
          verification: "  Account settings shows John Scout and john@eggfit.com.  ",
          ...(loginMethod === "oauth"
            ? {
                loginMethod,
                oauthProviderServiceDomain: "github.com",
                oauthProviderIdentifier: "john-scout",
              }
            : { loginMethod }),
        };
        const generatedInput =
          engine === "Convex Agent"
            ? await validateTypes({ value: input, schema: recordingTool.inputSchema })
            : input;
        const persistedInput: unknown = JSON.parse(JSON.stringify(generatedInput));
        expect(persistedInput).toEqual({
          ...input,
          verification: engine === "Convex Agent" ? input.verification.trim() : input.verification,
        });
        expect(record).not.toHaveBeenCalled();

        const runtimeTool = requireRuntimeTool(
          { record_authenticated_service_account: recordingTool },
          "record_authenticated_service_account",
        );
        await expect(runtimeTool.execute(persistedInput, toolOptions)).resolves.toEqual({
          serviceAccountId: "account-1",
          created: true,
        });
        expect(record).toHaveBeenCalledExactlyOnceWith(
          {
            accountAccess: input.accountAccess,
            identifier: input.identifier,
            verification: input.verification.trim(),
            loginMethod:
              loginMethod === "oauth"
                ? {
                    kind: "oauth",
                    providerServiceDomain: "github.com",
                    providerIdentifier: "john-scout",
                  }
                : { kind: loginMethod },
          },
          abortSignal,
        );
      },
    );
  });

  it.each(["managed_password", "passwordless", "oauth"])(
    "rejects an already-mapped %s login method before recording",
    async (kind) => {
      const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: true }));
      const runtimeTool = requireRuntimeTool(
        { record_authenticated_service_account: createServiceAccountRecordingTool(record) },
        "record_authenticated_service_account",
      );
      await expect(
        runtimeTool.execute(
          {
            accountAccess: "created",
            identifier: "john@eggfit.com",
            verification: "Account settings shows John Scout and john@eggfit.com.",
            loginMethod:
              kind === "oauth"
                ? { kind, providerServiceDomain: "github.com", providerIdentifier: "john-scout" }
                : { kind },
          },
          toolOptions,
        ),
      ).rejects.toThrow("No matching discriminator");
      expect(record).not.toHaveBeenCalled();
    },
  );

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
