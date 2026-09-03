export const CREATE_FIRECRAWL_SESSION_DESCRIPTION =
  "Create a Firecrawl browser session and open its first HTTPS page. Call once before browser_execute if no session is open. To navigate or open tabs after that, use Playwright in browser_execute.";

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

export const BROWSER_EXECUTE_DESCRIPTION = `Run JavaScript with Playwright's active page. Await every Playwright operation. Return a value when it helps the next decision; the current accessibility snapshot is always included. Use semantic locators for page controls and page.context() for tabs. The runtime defines this helper before running your code (comparableUrl removes URL query strings and fragments):

${BROWSER_STATE_HELPER_SOURCE}

After navigation or tab work, return await browserState(page), or pass another Page to report it as current. Select tabs by visible URL or title instead of remembered positions. Keep each call to one coherent step. Never enter a password here; use fill_account_password.`;

export const BROWSER_EXECUTE_EXAMPLE = `const cloudflare = await page.context().newPage();
await cloudflare.goto("https://dash.cloudflare.com");
return await browserState(cloudflare);`;

export const BROWSER_CLOSE_DESCRIPTION =
  "Stop the current Firecrawl browser session and report provider duration and credits. Call once after browser work is complete.";
