import assert from "node:assert/strict";
import { Window } from "happy-dom";

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
  `/sites/${encodeURIComponent(site)}?scope=public`,
  "/about",
  ...shellPaths,
  "/ssr-verification-missing-route",
];

for (const path of paths) {
  const response = await fetch(new URL(path, origin));
  const html = await response.text();
  assert.equal(response.status, path === paths.at(-1) ? 404 : 200, path);
  assert(!html.includes("Switched to client rendering because"), `${path}: SSR failed`);
  const window = new Window({ settings: { enableJavaScriptEvaluation: false } });
  const document = new window.DOMParser().parseFromString(html, "text/html");
  for (const script of document.querySelectorAll("script")) script.remove();
  const cards = document.querySelectorAll("article.site-card").length;
  const privateView = shellPaths.includes(path);
  if (privateView) {
    assert.equal(cards, 0, `${path}: private views must start with a browser shell`);
    assert.equal(document.querySelectorAll("h3").length, 0, path);
  } else if (path.startsWith("/sites/")) {
    assert(document.querySelector("h1"), `${path}: missing site identity in server HTML`);
    const tasks = document.querySelector(`section[aria-label="Tasks for ${site}"]`);
    assert(tasks?.querySelector("h3"), `${path}: missing public review in server HTML`);
  } else if (path === "/" || path.startsWith("/?")) {
    assert(cards > 0, `${path}: missing site cards in server HTML`);
    if (path !== "/") assert.equal(cards, 1, `${path}: site filter was not applied`);
  } else if (path === "/about") {
    assert(document.querySelector("h1"), "About content was not server rendered");
  }
  console.log(`${response.status} ${path}: ${cards} server-rendered site cards`);
  await window.happyDOM.close();
}
