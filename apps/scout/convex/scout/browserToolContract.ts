import { outdent } from "outdent";
export const CREATE_FIRECRAWL_SESSION_DESCRIPTION = outdent`
  Create a Firecrawl browser session and open its first HTTPS page. Call once before
  browser_execute if no session is open. To navigate or open tabs after that, use
  Playwright in browser_execute.
`;

export const BROWSER_EXECUTION_TIMEOUT_SECONDS = 60;
export const PLAYWRIGHT_ACTION_TIMEOUT_MS = 10_000;
export const PLAYWRIGHT_NAVIGATION_TIMEOUT_MS = 30_000;

export const BROWSER_STATE_HELPER_SOURCE = `const browserState = async (selectedPage = activePage) => {
  await selectedPage.bringToFront();
  selectedPage.setDefaultTimeout(${PLAYWRIGHT_ACTION_TIMEOUT_MS});
  selectedPage.setDefaultNavigationTimeout(${PLAYWRIGHT_NAVIGATION_TIMEOUT_MS});
  activePage = selectedPage;
  activeTabId = await tabId(selectedPage);
  return {
    currentUrl: comparableUrl(selectedPage.url()),
    title: await selectedPage.title().catch(() => ""),
    tabs: await Promise.all(
      selectedPage.context().pages()
        .filter((candidate) => candidate === selectedPage || candidate.url() !== "about:blank")
        .map(async (candidate) => ({
          url: comparableUrl(candidate.url()),
          title: await candidate.title().catch(() => ""),
        })),
    ),
  };
};`;

export const BROWSER_EXECUTE_DESCRIPTION = outdent`
  Run JavaScript with page, the active Playwright Page, and browserState(selectedPage = page),
  a provided helper returning { currentUrl, title, tabs: [{ url, title }] }.

  Page state:

  - Reported URLs omit query strings and fragments.
  - The current accessibility snapshot is always included, including after an error.

  Locators and tabs:

  - Prefer semantic locators from the latest snapshot. Quoted text after a role is its
    accessible name for getByRole; text after a colon is visible DOM text.
  - If the snapshot does not identify a control, inspect the page DOM to choose a locator.
  - Use page.context() for tabs. After navigation or tab work, call browserState(target)
    with the Page you selected. This selects it for the snapshot and subsequent calls.
  - Select tabs by visible URL or title instead of remembered positions.

  Execution and waits:

  - Await every Playwright operation. Keep each call to one coherent step.
  - Each call has a ${BROWSER_EXECUTION_TIMEOUT_SECONDS}-second execution limit, including waits.
  - Check the current state before waiting. Prefer bounded Playwright waits for an
    observable change over fixed sleeps, and return before the execution limit so the
    next call can reevaluate progress or completion.
  - After an error, use the fresh snapshot to correct the failed locator or assumption
    before retrying.
  - Never enter a password here; use fill_account_password.
`;

export const BROWSER_EXECUTE_EXAMPLE = outdent`
  const cloudflare = await page.context().newPage();
  await cloudflare.goto("https://dash.cloudflare.com");
  return await browserState(cloudflare);
`;

export const BROWSER_SCREENSHOT_DESCRIPTION = outdent`
  Occasional screenshots:

  - Continue the normal task and set captureNote only when the resulting page is useful
    evidence for the walkthrough. Describe what the capture should show. Use null otherwise.
  - Capture records the final selected tab after this code runs. After changing tabs,
    select the intended Page with browserState(target). For a stationary capture, use
    return await browserState(page).
  - The capture result returns a captureId, note, and observed metadata for later walkthrough
    references. Continue from the browser state and your observations.
  - Capture can fail independently of the action. Never repeat a successful action because
    its screenshot or upload failed. Inspect the current state before requesting another capture.
`;

export const BROWSER_CLOSE_DESCRIPTION = outdent`
  Stop the current Firecrawl browser session and report provider duration and credits.
  Call once after browser work is complete.
`;
