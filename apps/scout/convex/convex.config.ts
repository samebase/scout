import { defineApp } from "convex/server";
import { v } from "convex/values";
import agent from "@convex-dev/agent/convex.config";
import r2 from "@convex-dev/r2/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import workflow from "@convex-dev/workflow/convex.config.js";

// Keep existing app HTTP routes at their current root URLs.
const app = defineApp({
  env: {
    AGENTMAIL_API_KEY: v.optional(v.string()),
    CLOUDFLARE_EMAIL_ACCOUNT_ID: v.optional(v.string()),
    CLOUDFLARE_EMAIL_API_TOKEN: v.optional(v.string()),
    CREDITS_ENABLED: v.optional(v.string()),
    DEV_SEED_AUTH_EMAIL: v.optional(v.string()),
    DEV_SEED_AUTH_ENABLED: v.optional(v.string()),
    DEV_SEED_AUTH_PASSWORD: v.optional(v.string()),
    FIRECRAWL_API_KEY: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    POLAR_ACCESS_TOKEN: v.optional(v.string()),
    POLAR_CHECKOUT_ENABLED: v.optional(v.string()),
    POLAR_CREDIT_PRODUCT_ID: v.optional(v.string()),
    POLAR_ORGANIZATION_ID: v.optional(v.string()),
    POLAR_SERVER: v.optional(v.string()),
    POLAR_WEBHOOK_SECRET: v.optional(v.string()),
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

export default app;
