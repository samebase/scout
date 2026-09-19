const ACCESS_TOKEN_PATTERN = /^hh1_[A-Za-z0-9_-]{43}$/;
const ACCESS_TOKEN_STORAGE_PREFIX = "scout:human-handoff-access:";

type HandoffBrowser = {
  location: Pick<Location, "hash" | "pathname" | "search">;
  history: Pick<History, "replaceState" | "state">;
  sessionStorage: Pick<Storage, "getItem" | "removeItem" | "setItem">;
};

export function humanHandoffIsTopLevel(browser: { readonly self: unknown; readonly top: unknown }) {
  return browser.self === browser.top;
}

export function consumeHumanHandoffAccessToken(browser: HandoffBrowser) {
  const storageKey = `${ACCESS_TOKEN_STORAGE_PREFIX}${browser.location.pathname}`;
  const fragment = browser.location.hash.slice(1);
  browser.history.replaceState(
    browser.history.state,
    "",
    browser.location.pathname + browser.location.search,
  );
  const accessToken = fragment
    ? fragment.startsWith("access=")
      ? fragment.slice("access=".length)
      : null
    : browser.sessionStorage.getItem(storageKey);

  if (accessToken !== null && ACCESS_TOKEN_PATTERN.test(accessToken)) {
    browser.sessionStorage.setItem(storageKey, accessToken);
    return accessToken;
  }
  browser.sessionStorage.removeItem(storageKey);
  return null;
}
