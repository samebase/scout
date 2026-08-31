/// <reference types="vite/client" />

import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { ADMIN_EMAIL } from "./authConfig";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function testBackend() {
  const backend = convexTest(schema, modules);
  agentTest.register(backend);
  return backend;
}

describe("Scout Lab", () => {
  it("creates a developer experiment and stores messages as shared Scout turns", async () => {
    const backend = testBackend();
    const userId = await backend.run(
      async (ctx) => await ctx.db.insert("users", { email: ADMIN_EMAIL }),
    );
    const scoutId = await backend.run(
      async (ctx) =>
        await ctx.db.insert("scouts", {
          displayName: "Conrad Scout",
          websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
          slug: "conrad",
          status: "active",
          agentMail: { inboxId: "conrad-inbox", address: "conrad@example.test" },
          firecrawl: { profileName: "conrad-profile" },
        }),
    );
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });
    const { experimentId } = await admin.mutation(api.scout.lab.createExperiment, {
      name: "Explore Tally",
      scoutId,
      targetProduct: "Tally",
      targetDomain: "tally.so",
      objective: "Explore the current onboarding.",
    });
    const { threadId } = await admin.mutation(api.scout.lab.createThread, { experimentId });
    await admin.mutation(api.scout.lab.sendMessage, {
      threadId,
      prompt: "Open the product and report what you see.",
    });
    const turn = await backend.run(
      async (ctx) =>
        await ctx.db
          .query("scoutTurns")
          .withIndex("by_thread_id_and_order", (index) => index.eq("threadId", threadId))
          .unique(),
    );
    expect(turn).toEqual(
      expect.objectContaining({
        scoutId,
        model: "qwen/qwen3.7-flash",
        state: expect.objectContaining({ kind: "pending" }),
      }),
    );
  });
});
