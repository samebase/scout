import { defineApp } from "convex/server";
import { v } from "convex/values";
import agent from "@convex-dev/agent/convex.config";
import auth from "@convex-dev/auth/convex.config";
import email from "@convex-dev/auth/components/email/convex.config";
import oauth from "@convex-dev/auth/components/oauth/convex.config";
import password from "@convex-dev/auth/components/password/convex.config";
import r2 from "@convex-dev/r2/convex.config";
import hosting from "@samebase/convex-hosting/convex.config";
import workflow from "@convex-dev/workflow/convex.config.js";

// Keep existing app HTTP routes at their current root URLs.
const app = defineApp({
  env: {
    AGENTMAIL_API_KEY: v.optional(v.string()),
    AUTH_JWKS: v.string(),
    AUTH_PRIVATE_KEY: v.string(),
    // Optional because development and preview deployments may have none. The production deploy
    // (alchemy.run.ts) sets both, and convex/email.ts fails a send without them.
    CLOUDFLARE_EMAIL_ACCOUNT_ID: v.optional(v.string()),
    CLOUDFLARE_EMAIL_API_TOKEN: v.optional(v.string()),
    CREDITS_ENABLED: v.optional(v.string()),
    DEV_SEED_AUTH_EMAIL: v.optional(v.string()),
    DEV_SEED_AUTH_ENABLED: v.optional(v.string()),
    DEV_SEED_AUTH_PASSWORD: v.optional(v.string()),
    FIRECRAWL_API_KEY: v.optional(v.string()),
    // <CONVEX_SITE_URL>/oauth-client.json, the document that convex/http.ts serves.
    OAUTH_CLIENT_ID: v.string(),
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
    PUBLIC_MEDIA_BUCKET: v.optional(v.string()),
    PUBLIC_MEDIA_ORIGIN: v.optional(v.string()),
    PUBLIC_MEDIA_ACCESS_KEY_ID: v.optional(v.string()),
    PUBLIC_MEDIA_SECRET_ACCESS_KEY: v.optional(v.string()),
    PUBLIC_MEDIA_ZONE_ID: v.optional(v.string()),
    PUBLIC_MEDIA_CACHE_PURGE_TOKEN: v.optional(v.string()),
    SCOUT_CREDENTIAL_MASTER_KEY_V1: v.optional(v.string()),
    SCOUT_COMPACTION_TOKENS: v.optional(v.string()),
    SITE_URL: v.string(),
    SSR_FIXTURE_DEPLOYMENT_URL: v.optional(v.string()),
  },
});
// A push fails while AUTH_PRIVATE_KEY, AUTH_JWKS or OAUTH_CLIENT_ID is missing:
// scripts/ensure-convex-auth.ts sets them before each push. The core serves its key set under /auth.
app.use(auth, {
  httpPrefix: "/auth",
  env: {
    AUTH_PRIVATE_KEY: app.env.AUTH_PRIVATE_KEY,
    AUTH_JWKS: app.env.AUTH_JWKS,
  },
});
// Google sign-in at login.samebase.com as a public client: the empty secret counts as none at its
// token endpoint. The broker sends the browser back to <CONVEX_SITE_URL>/auth/hub/callback. The name
// keeps "hub": the component's stored data holds it.
app.use(oauth, {
  name: "authHub",
  httpPrefix: "/auth/hub",
  env: { CLIENT_ID: app.env.OAUTH_CLIENT_ID, CLIENT_SECRET: "" },
});
app.use(password);
app.use(email);
app.use(agent);
app.use(r2);
app.use(workflow);
app.use(hosting);

export default app;
