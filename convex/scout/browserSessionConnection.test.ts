import { describe, expect, it, vi } from "vite-plus/test";
import { attachPersistedBrowserSession } from "./browserSessionConnection";

const persisted = {
  providerSessionId: "session-1",
  cdpUrl: "wss://browser.firecrawl.dev/cdp?token=stored",
  interactiveLiveViewUrl: null,
};

describe("persisted browser session connections", () => {
  it("connects directly without listing provider sessions", async () => {
    const attach = vi.fn(async () => undefined);
    const recoverActiveBrowserSession = vi.fn(async () => null);

    await expect(
      attachPersistedBrowserSession({ attach }, persisted, undefined, {
        recoverActiveBrowserSession,
      }),
    ).resolves.toEqual(persisted);

    expect(attach).toHaveBeenCalledExactlyOnceWith(
      persisted,
      { captureOperations: true },
      undefined,
    );
    expect(recoverActiveBrowserSession).not.toHaveBeenCalled();
  });

  it("lists once only after direct connection fails", async () => {
    const recovered = {
      ...persisted,
      cdpUrl: "wss://browser.firecrawl.dev/cdp?token=recovered",
    };
    const attach = vi
      .fn(async () => undefined)
      .mockRejectedValueOnce(new Error("stored connection failed"));
    const recoverActiveBrowserSession = vi.fn(async () => recovered);

    await expect(
      attachPersistedBrowserSession({ attach }, persisted, undefined, {
        recoverActiveBrowserSession,
      }),
    ).resolves.toEqual(recovered);

    expect(recoverActiveBrowserSession).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it("reports that the provider session ended after failed recovery", async () => {
    const attach = vi.fn(async () => {
      throw new Error("stored connection failed");
    });
    const recoverActiveBrowserSession = vi.fn(async () => null);

    await expect(
      attachPersistedBrowserSession({ attach }, persisted, undefined, {
        recoverActiveBrowserSession,
      }),
    ).resolves.toBeNull();

    expect(recoverActiveBrowserSession).toHaveBeenCalledOnce();
    expect(attach).toHaveBeenCalledOnce();
  });

  it("does not recover a connection after its caller is canceled", async () => {
    const cancellation = new Error("slice canceled");
    const abortController = new AbortController();
    abortController.abort(cancellation);
    const attach = vi.fn(async () => {
      throw cancellation;
    });
    const recoverActiveBrowserSession = vi.fn(async () => null);

    await expect(
      attachPersistedBrowserSession({ attach }, persisted, abortController.signal, {
        recoverActiveBrowserSession,
      }),
    ).rejects.toBe(cancellation);

    expect(recoverActiveBrowserSession).not.toHaveBeenCalled();
  });

  it("stops waiting when its caller is canceled during recovery", async () => {
    const cancellation = new Error("slice canceled");
    const abortController = new AbortController();
    const attach = vi.fn(async () => {
      throw new Error("stored connection failed");
    });
    const recoverActiveBrowserSession = vi.fn(async () => await new Promise<null>(() => undefined));

    const reconnect = attachPersistedBrowserSession({ attach }, persisted, abortController.signal, {
      recoverActiveBrowserSession,
    });
    await vi.waitFor(() => expect(recoverActiveBrowserSession).toHaveBeenCalledOnce());
    abortController.abort(cancellation);

    await expect(reconnect).rejects.toBe(cancellation);
    expect(attach).toHaveBeenCalledOnce();
  });
});
