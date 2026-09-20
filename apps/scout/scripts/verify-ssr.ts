import assert from "node:assert/strict";
import { Window, type Document } from "happy-dom";

const [origin, site] = process.argv.slice(2);
if (!origin || !site) {
  throw new Error("Usage: node apps/scout/scripts/verify-ssr.ts <origin> <public-site-hostname>");
}

const shellPaths = [
  "/?scope=mine",
  `/sites/${encodeURIComponent(site)}?scope=mine`,
  `/sites/${encodeURIComponent(site)}?view=workspace`,
  "/settings",
  "/credit-history",
  "/lab",
  "/tasks/ssr-verification",
];
const paths = [
  "/",
  `/?site=${encodeURIComponent(site)}&scope=public`,
  `/sites/${encodeURIComponent(site)}`,
  `/sites/${encodeURIComponent(site)}?scope=public`,
  `/sites/${encodeURIComponent(site)}?scope=public&view=tasks`,
  "/about",
  ...shellPaths,
  "/ssr-verification-missing-route",
];

async function verifyHtml<T>(
  path: string,
  verify: (document: Document) => T,
  expectedStatus: number,
) {
  const response = await fetch(new URL(path, origin));
  const html = await response.text();
  assert.equal(response.status, expectedStatus, path);
  assert(!html.includes("Switched to client rendering because"), `${path}: SSR failed`);
  const window = new Window({ settings: { enableJavaScriptEvaluation: false } });
  try {
    const document = new window.DOMParser().parseFromString(html, "text/html");
    for (const script of document.querySelectorAll("script")) script.remove();
    const result = verify(document);
    console.log(`${response.status} ${path}`);
    return result;
  } finally {
    await window.happyDOM.close();
  }
}

let taskHref: string | undefined;
for (const path of paths) {
  await verifyHtml(
    path,
    (document) => {
      const cards = document.querySelectorAll("article.site-card").length;
      const privateView = shellPaths.includes(path);
      if (privateView) {
        assert.equal(cards, 0, `${path}: private views must start with a browser shell`);
        assert.equal(document.querySelectorAll("h3").length, 0, path);
      } else if (path.startsWith("/sites/")) {
        assert(document.querySelector("h1"), `${path}: missing site identity in server HTML`);
        const tasks = document.querySelector(`section[aria-label="Tasks for ${site}"]`);
        assert(tasks && tasks.querySelector("h3"), `${path}: missing public review in server HTML`);
        taskHref ??= tasks.querySelector('a[href^="/tasks/"]')?.getAttribute("href") ?? undefined;
        assert(
          document.querySelector('nav[aria-label="Sites"] article.site-card'),
          `${path}: missing sites sidebar in server HTML`,
        );
      } else if (path === "/" || path.startsWith("/?")) {
        assert(cards > 0, `${path}: missing site cards in server HTML`);
        if (path !== "/") assert.equal(cards, 1, `${path}: site filter was not applied`);
      } else if (path === "/about") {
        assert(document.querySelector("h1"), "About content was not server rendered");
      }
    },
    path === paths.at(-1) ? 404 : 200,
  );
}

assert(taskHref, "The public site must link to a review to verify task SSR");
const taskUrl = new URL(taskHref, origin);
await verifyHtml(
  taskUrl.pathname,
  (document) => {
    assert(document.querySelector("h1")?.textContent.trim(), "Missing direct review title");
    assert(
      document.querySelector('[role="log"][aria-label="Session messages"]') ||
        document.querySelector('section[aria-label="Task walkthrough"] h2'),
      "Missing direct review content in server HTML",
    );
  },
  200,
);
taskUrl.searchParams.set("scope", "public");
taskUrl.searchParams.set("view", "chat");
const { scoutHref, walkthroughHref } = await verifyHtml(
  `${taskUrl.pathname}${taskUrl.search}`,
  (document) => {
    assert(document.querySelector("h1")?.textContent.trim(), "Missing review title in server HTML");
    const navigation = document.querySelector(`nav[aria-label="Tasks for ${site}"]`);
    const selected = navigation?.querySelector('a[aria-current="page"]')?.getAttribute("href");
    assert(selected, "Missing selected review in the server-rendered task sidebar");
    assert.equal(new URL(selected, origin).pathname, taskUrl.pathname);
    const messages = document.querySelector('[role="log"][aria-label="Session messages"]');
    assert(messages && messages.textContent.trim(), "Missing review transcript in server HTML");
    assert.notEqual(messages.getAttribute("aria-busy"), "true", "Transcript is still pending");
    const scout = document.querySelector('a[href^="/scouts/"]')?.getAttribute("href");
    assert(scout, "Missing Scout profile link in the server-rendered review");
    const walkthrough = Array.from(document.querySelectorAll('nav[aria-label="Review views"] a'))
      .map((link) => link.getAttribute("href"))
      .find((href) => href && new URL(href, origin).searchParams.get("view") === "walkthrough");
    return { scoutHref: scout, walkthroughHref: walkthrough };
  },
  200,
);

if (walkthroughHref) {
  await verifyHtml(
    walkthroughHref,
    (document) => {
      const walkthrough = document.querySelector('section[aria-label="Task walkthrough"]');
      assert(
        walkthrough && walkthrough.querySelector("h2")?.textContent.trim(),
        "Missing walkthrough in server HTML",
      );
      assert(
        walkthrough.querySelector("p")?.textContent.trim(),
        "Missing walkthrough text in server HTML",
      );
      assert.notEqual(
        walkthrough.getAttribute("aria-busy"),
        "true",
        "Walkthrough is still pending",
      );
      if (!walkthrough.querySelector('nav[aria-label="Walkthrough steps"]')) {
        console.log(`Walkthrough notice: ${walkthrough.querySelector("h2")?.textContent.trim()}`);
      }
    },
    200,
  );
} else {
  console.log("The selected public review has no walkthrough view");
}

taskUrl.searchParams.set("scope", "mine");
await verifyHtml(
  `${taskUrl.pathname}${taskUrl.search}`,
  (document) => {
    assert.equal(
      document.querySelector("h1"),
      null,
      "Private task scope must start with a browser shell",
    );
    assert.equal(
      document.querySelector('[role="log"]'),
      null,
      "Private task scope rendered messages",
    );
  },
  200,
);

await verifyHtml(
  "/scouts",
  (document) => {
    assert.equal(document.querySelector("h1")?.textContent.trim(), "Scouts");
    const scouts = document.querySelector('ul[aria-label="Scouts"]');
    assert(
      scouts && scouts.querySelector("h2")?.textContent.trim(),
      "Missing Scout directory entries in server HTML",
    );
    assert(
      Array.from(scouts.querySelectorAll("a")).some(
        (link) => link.getAttribute("href") === scoutHref,
      ),
      "The review's Scout is missing from the server-rendered directory",
    );
  },
  200,
);
await verifyHtml(
  scoutHref,
  (document) => {
    assert(document.querySelector("h1")?.textContent.trim(), "Missing Scout name in server HTML");
    const identity = document.querySelector('section[aria-labelledby="scout-identity-heading"]');
    assert(
      identity && identity.querySelector("dd")?.textContent.trim(),
      "Missing Scout identity in server HTML",
    );
    assert.equal(
      document.querySelector("#scout-provider-connections-heading"),
      null,
      "Runtime resources rendered anonymously",
    );
    assert(
      !Array.from(identity.querySelectorAll("dt")).some(
        (label) => label.textContent.trim() === "Email",
      ),
      "Scout email rendered anonymously",
    );
  },
  200,
);
