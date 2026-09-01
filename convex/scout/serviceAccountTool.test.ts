import { describe, expect, it, vi } from "vite-plus/test";
import { createServiceAccountRecordingTool } from "./serviceAccountTool";

const toolOptions = { toolCallId: "tool-1", messages: [], context: {} };

describe("Scout service-account recording tool", () => {
  const identityTarget = { kind: "text", text: "conrad@example.test", exact: true } as const;
  const sessionControlTarget = {
    kind: "role",
    role: "button",
    name: "Sign out",
    exact: true,
  } as const;

  it("passes only account access and visible evidence targets to trusted code", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: false }));
    const recordingTool = createServiceAccountRecordingTool(record);

    await expect(
      recordingTool.execute(
        {
          accountAccess: "created",
          loginMethod: { kind: "managed_password" },
          identityTarget,
          sessionControlTarget,
        },
        toolOptions,
      ),
    ).resolves.toEqual({ serviceAccountId: "account-1", created: false });
    expect(record).toHaveBeenCalledWith({
      accountAccess: "created",
      loginMethod: { kind: "managed_password" },
      identityTarget,
      sessionControlTarget,
    });
  });

  it("rejects a model-supplied account identifier", async () => {
    const record = vi.fn(async () => ({ serviceAccountId: "account-1", created: false }));
    const recordingTool = createServiceAccountRecordingTool(record);
    const invalidInput: {
      accountAccess: "created";
      loginMethod: { kind: "managed_password" };
      identityTarget: typeof identityTarget;
      sessionControlTarget: typeof sessionControlTarget;
      identifier: string;
    } = {
      accountAccess: "created",
      loginMethod: { kind: "managed_password" },
      identityTarget,
      sessionControlTarget,
      identifier: "other@example.test",
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
        loginMethod: {
          kind: "oauth",
          providerServiceDomain: "github.com",
          providerIdentifier: "conrad-scout",
        },
        identityTarget,
        sessionControlTarget,
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
      identityTarget,
      sessionControlTarget,
    });
  });
});
