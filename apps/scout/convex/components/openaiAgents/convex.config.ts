import { defineComponent } from "convex/server";
import { v } from "convex/values";

export default defineComponent("openaiAgents", {
  env: {
    OPENAI_API_KEY: v.optional(v.string()),
    OPENAI_WEBHOOK_SECRET: v.optional(v.string()),
  },
});
