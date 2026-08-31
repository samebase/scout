const ACCESS_TOKEN_PATTERN = /^hh1_[A-Za-z0-9_-]{43}$/;

type HandoffBrowser = {
  location: Pick<Location, "hash" | "pathname" | "search">;
  history: Pick<History, "replaceState" | "state">;
};

export function humanHandoffIsTopLevel(browser: { readonly self: unknown; readonly top: unknown }) {
  return browser.self === browser.top;
}

export function consumeHumanHandoffAccessToken(browser: HandoffBrowser) {
  if (!browser.location.hash) return null;
  const fragment = browser.location.hash.slice(1);
  const accessToken = fragment.startsWith("access=") ? fragment.slice("access=".length) : null;
  browser.history.replaceState(
    browser.history.state,
    "",
    browser.location.pathname + browser.location.search,
  );
  return accessToken !== null && ACCESS_TOKEN_PATTERN.test(accessToken) ? accessToken : null;
}
