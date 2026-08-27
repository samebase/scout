import { defineApp } from "convex/server";
import { v } from "convex/values";
import staticHosting from "@convex-dev/static-hosting/convex.config";

// Keep existing app HTTP routes at their current root URLs.
const app = defineApp({
  env: {
    AGENTMAIL_API_KEY: v.optional(v.string()),
    FIRECRAWL_API_KEY: v.optional(v.string()),
    SCOUT_AGENT_PASSWORD: v.optional(v.string()),
  },
});
app.use(staticHosting);

export default app;
