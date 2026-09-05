export const CREATE_FIRECRAWL_SESSION_DESCRIPTION =
  "Create a Firecrawl browser session and open its first HTTPS page. Call once before browser_execute if no session is open. To navigate or open tabs after that, use Playwright in browser_execute.";

export const BROWSER_EXECUTION_TIMEOUT_SECONDS = 60;

export const BROWSER_STATE_HELPER_SOURCE = `const browserState = async (selectedPage = activePage) => ({
  currentUrl: comparableUrl(selectedPage.url()),
  title: await selectedPage.title().catch(() => ""),
  tabs: await Promise.all(
    selectedPage.context().pages().map(async (candidate) => ({
      url: comparableUrl(candidate.url()),
      title: await candidate.title().catch(() => ""),
    })),
  ),
});`;

export const BROWSER_EXECUTE_DESCRIPTION = `Run JavaScript with page, the active Playwright Page, and browserState(selectedPage = page), a provided helper returning { currentUrl, title, tabs: [{ url, title }] }. Reported URLs omit query strings and fragments. Await every Playwright operation. The current accessibility snapshot is always included, including after an error.

Use semantic locators from the latest snapshot. Quoted text after a role is its accessible name for getByRole; text after a colon is visible DOM text. Use page.context() for tabs. After navigation or tab work, return await browserState(page), or pass another Page to report it as current. Select tabs by visible URL or title instead of remembered positions.

Each call has a ${BROWSER_EXECUTION_TIMEOUT_SECONDS}-second execution limit, including waits. Check the current state before waiting. Prefer bounded Playwright waits for an observable change over fixed sleeps, and return before the execution limit so the next call can reevaluate progress or completion. After an error, use the fresh snapshot to correct the failed locator or assumption before retrying.

Keep each call to one coherent step. Never enter a password here; use fill_account_password.`;

export const BROWSER_EXECUTE_EXAMPLE = `const cloudflare = await page.context().newPage();
await cloudflare.goto("https://dash.cloudflare.com");
return await browserState(cloudflare);`;

export const BROWSER_CLOSE_DESCRIPTION =
  "Stop the current Firecrawl browser session and report provider duration and credits. Call once after browser work is complete.";
