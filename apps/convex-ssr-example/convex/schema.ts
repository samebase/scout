import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  listings: defineTable({ hostname: v.string(), title: v.string() }).index("by_hostname", [
    "hostname",
  ]),
});
