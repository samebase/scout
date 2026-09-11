"use node";

import { type BrowserSessionHandle, createBrowserHarness } from "./browserTools";
import { recoverActiveFirecrawlBrowserSession } from "./lib/firecrawl";
import { omitNullish } from "../../shared/omitNullish";

type Browser = Pick<ReturnType<typeof createBrowserHarness>, "attach">;
type Dependencies = {
  recoverActiveBrowserSession: typeof recoverActiveFirecrawlBrowserSession;
};

const defaultDependencies: Dependencies = {
  recoverActiveBrowserSession: recoverActiveFirecrawlBrowserSession,
};

async function recoverUntilCanceled(
  providerSessionId: string,
  abortSignal: AbortSignal | undefined,
  recover: Dependencies["recoverActiveBrowserSession"],
) {
  const recovery = recover(providerSessionId);
  if (!abortSignal) return await recovery;
  abortSignal.throwIfAborted();
  return await new Promise<Awaited<typeof recovery>>((resolve, reject) => {
    const canceled = () => reject(abortSignal.reason);
    abortSignal.addEventListener("abort", canceled, { once: true });
    void recovery.then(resolve, reject).finally(() => {
      abortSignal.removeEventListener("abort", canceled);
    });
  });
}

export async function attachPersistedBrowserSession(
  browser: Browser,
  session: BrowserSessionHandle,
  abortSignal?: AbortSignal,
  dependencies: Dependencies = defaultDependencies,
) {
  try {
    await browser.attach(session, { captureOperations: true }, abortSignal);
    return session;
  } catch (connectionError) {
    abortSignal?.throwIfAborted();
    let recovered: Awaited<ReturnType<typeof recoverActiveFirecrawlBrowserSession>>;
    try {
      recovered = await recoverUntilCanceled(
        session.providerSessionId,
        abortSignal,
        dependencies.recoverActiveBrowserSession,
      );
    } catch (recoveryError) {
      abortSignal?.throwIfAborted();
      throw new AggregateError(
        [connectionError, recoveryError],
        "Playwright reconnect and Firecrawl session recovery both failed",
      );
    }
    if (!recovered) return null;
    abortSignal?.throwIfAborted();
    const connection = { ...recovered, ...omitNullish({ selectedTabId: session.selectedTabId }) };
    await browser.attach(connection, { captureOperations: true }, abortSignal);
    return connection;
  }
}
