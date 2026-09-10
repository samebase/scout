import { defineApp } from "convex/server";
import { v } from "convex/values";
import agent from "@convex-dev/agent/convex.config";
import r2 from "@convex-dev/r2/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import workflow from "@convex-dev/workflow/convex.config.js";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";

// Keep existing app HTTP routes at their current root URLs.
const app = defineApp({
  env: {
    AGENTMAIL_API_KEY: v.optional(v.string()),
    CLOUDFLARE_EMAIL_ACCOUNT_ID: v.optional(v.string()),
    CLOUDFLARE_EMAIL_API_TOKEN: v.optional(v.string()),
    DEV_SEED_AUTH_EMAIL: v.optional(v.string()),
    DEV_SEED_AUTH_ENABLED: v.optional(v.string()),
    DEV_SEED_AUTH_PASSWORD: v.optional(v.string()),
    FIRECRAWL_API_KEY: v.string(),
    R2_BUCKET: v.optional(v.string()),
    R2_ENDPOINT: v.optional(v.string()),
    R2_ACCESS_KEY_ID: v.optional(v.string()),
    R2_SECRET_ACCESS_KEY: v.optional(v.string()),
    SCOUT_CREDENTIAL_MASTER_KEY_V1: v.optional(v.string()),
    SCOUT_COMPACTION_TOKENS: v.optional(v.string()),
    SITE_URL: v.optional(v.string()),
  },
});
app.use(agent);
app.use(r2);
app.use(workflow);
app.use(staticHosting);
app.use(firecrawl, {
  env: { FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY },
});

export default app;
