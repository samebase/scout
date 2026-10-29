import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Alchemy supplies a temporary CONVEX_DEPLOY_KEY for this preview to every command below.
const convex = fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url));

// The push needs SITE_URL, the origin of the emailed sign-up and recovery links: the preview's own
// site. An inline query runs before the first push.
const siteUrl: unknown = JSON.parse(
  execFileSync(process.execPath, [convex, "run", "--inline-query", "process.env.CONVEX_SITE_URL"], {
    encoding: "utf8",
  }),
);
if (typeof siteUrl !== "string") {
  throw new Error("The preview deployment has no CONVEX_SITE_URL.");
}
execFileSync(process.execPath, [convex, "env", "set", "SITE_URL", siteUrl], { stdio: "inherit" });
execFileSync(process.execPath, ["--run", "deploy"], { stdio: "inherit" });
execFileSync(process.execPath, [convex, "run", "devAuth:seedPasswordAccount"], {
  stdio: "inherit",
});
