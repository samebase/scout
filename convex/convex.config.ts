import { defineApp } from "convex/server";
import { v } from "convex/values";
import agent from "@convex-dev/agent/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import workflow from "@convex-dev/workflow/convex.config.js";

// Keep existing app HTTP routes at their current root URLs.
const app = defineApp({
  env: {
    AGENTMAIL_API_KEY: v.optional(v.string()),
    CLOUDFLARE_EMAIL_ACCOUNT_ID: v.optional(v.string()),
    CLOUDFLARE_EMAIL_API_TOKEN: v.optional(v.string()),
    DEV_SEED_AUTH_EMAIL: v.optional(v.string()),
    DEV_SEED_AUTH_ENABLED: v.optional(v.string()),
    DEV_SEED_AUTH_PASSWORD: v.optional(v.string()),
    FIRECRAWL_API_KEY: v.optional(v.string()),
  },
});
app.use(agent);
app.use(workflow);
app.use(staticHosting);

export default app;
