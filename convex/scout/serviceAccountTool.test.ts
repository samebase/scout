import { describe, expect, it, vi } from "vite-plus/test";
import { createServiceAccountRecordingTool } from "./serviceAccountTool";

const toolOptions = { toolCallId: "tool-1", messages: [], context: {} };

describe("Scout service-account recording tool", () => {
  it("normalizes flat managed-password evidence for trusted code", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: false }));
    const recordingTool = createServiceAccountRecordingTool(record);

    await expect(
      recordingTool.execute(
        {
          accountAccess: "created",
          loginMethod: "managed_password",
          identityText: "conrad@example.test",
          sessionControlText: "Sign out",
        },
        toolOptions,
      ),
    ).resolves.toEqual({ serviceAccountId: "account-1", created: false });
    expect(record).toHaveBeenCalledWith({
      accountAccess: "created",
      loginMethod: { kind: "managed_password" },
      identityText: "conrad@example.test",
      sessionControlText: "Sign out",
    });
  });

  it.each([
    "identifier",
    "serviceAccountId",
    "scoutId",
    "sessionId",
    "serviceDomain",
    "observedUrl",
  ])("rejects model-supplied account or browser scope: %s", async (field) => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: false }));
    const recordingTool = createServiceAccountRecordingTool(record);
    const invalidInput: {
      accountAccess: "created";
      loginMethod: "managed_password";
      identityText: string;
      sessionControlText: string;
      [field: string]: string;
    } = {
      accountAccess: "created",
      loginMethod: "managed_password",
      identityText: "conrad@example.test",
      sessionControlText: "Sign out",
      [field]: "other@example.test",
    };

    await expect(recordingTool.execute(invalidInput, toolOptions)).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it("passes an exact OAuth provider account identity to trusted code", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: true }));
    const recordingTool = createServiceAccountRecordingTool(record);

    await recordingTool.execute(
      {
        accountAccess: "created",
        loginMethod: "oauth",
        oauthProviderServiceDomain: "github.com",
        oauthProviderIdentifier: "conrad-scout",
        identityText: "conrad@example.test",
        sessionControlText: "Sign out",
      },
      toolOptions,
    );

    expect(record).toHaveBeenCalledWith({
      accountAccess: "created",
      loginMethod: {
        kind: "oauth",
        providerServiceDomain: "github.com",
        providerIdentifier: "conrad-scout",
      },
      identityText: "conrad@example.test",
      sessionControlText: "Sign out",
    });
  });

  it("requires an exact provider account for OAuth", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: true }));
    const recordingTool = createServiceAccountRecordingTool(record);

    await expect(
      recordingTool.execute(
        {
          accountAccess: "created",
          loginMethod: "oauth",
          identityText: "conrad@example.test",
          sessionControlText: "Sign out",
        },
        toolOptions,
      ),
    ).rejects.toThrow("OAuth account recording requires the provider domain and identifier");
    expect(record).not.toHaveBeenCalled();
  });
});
