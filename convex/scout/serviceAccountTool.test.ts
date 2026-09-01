import { describe, expect, it, vi } from "vite-plus/test";
import { createServiceAccountRecordingTool } from "./serviceAccountTool";

const toolOptions = { toolCallId: "tool-1", messages: [], context: {} };

describe("Scout service-account recording tool", () => {
  it("passes only account access and visible evidence refs to trusted code", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: false }));
    const recordingTool = createServiceAccountRecordingTool(record);

    await expect(
      recordingTool.execute(
        {
          accountAccess: "created",
          loginMethod: { kind: "managed_password" },
          identityRef: "@e3",
          sessionControlRef: "@e4",
        },
        toolOptions,
      ),
    ).resolves.toEqual({ serviceAccountId: "account-1", created: false });
    expect(record).toHaveBeenCalledWith({
      accountAccess: "created",
      loginMethod: { kind: "managed_password" },
      identityRef: "@e3",
      sessionControlRef: "@e4",
    });
  });

  it("rejects a model-supplied account identifier", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: false }));
    const recordingTool = createServiceAccountRecordingTool(record);
    const legacyInput: {
      accountAccess: "created";
      loginMethod: { kind: "managed_password" };
      identityRef: string;
      sessionControlRef: string;
      identifier: string;
    } = {
      accountAccess: "created",
      loginMethod: { kind: "managed_password" },
      identityRef: "@e3",
      sessionControlRef: "@e4",
      identifier: "other@example.test",
    };

    await expect(recordingTool.execute(legacyInput, toolOptions)).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it("passes an exact OAuth provider account identity to trusted code", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: true }));
    const recordingTool = createServiceAccountRecordingTool(record);

    await recordingTool.execute(
      {
        accountAccess: "created",
        loginMethod: {
          kind: "oauth",
          providerServiceDomain: "github.com",
          providerIdentifier: "conrad-scout",
        },
        identityRef: "@e3",
        sessionControlRef: "@e4",
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
      identityRef: "@e3",
      sessionControlRef: "@e4",
    });
  });
});
