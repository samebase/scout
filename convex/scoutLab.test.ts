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

async function insertUser(backend: ReturnType<typeof testBackend>, email: string) {
  return await backend.run(async (ctx) => await ctx.db.insert("users", { email }));
}

describe("Scout agent lab", () => {
  it("rejects unauthenticated and non-admin access", async () => {
    const backend = testBackend();

    await expect(backend.query(api.scout.lab.latestThread, {})).rejects.toThrow("Not authorized");

    const userId = await insertUser(backend, "person@example.com");
    const nonAdmin = backend.withIdentity({ subject: `${userId}|test-session` });
    await expect(nonAdmin.mutation(api.scout.lab.createThread, {})).rejects.toThrow(
      "Not authorized",
    );
  });

  it("creates, resumes, and writes only the administrator's own thread", async () => {
    const backend = testBackend();
    const userId = await insertUser(backend, ADMIN_EMAIL);
    const admin = backend.withIdentity({ subject: `${userId}|test-session` });

    const created = await admin.mutation(api.scout.lab.createThread, {});
    await expect(admin.query(api.scout.lab.latestThread, {})).resolves.toEqual(created);

    await admin.mutation(api.scout.lab.sendMessage, {
      threadId: created.threadId,
      prompt: "  Say hello.  ",
    });
    const messages = await admin.query(api.scout.lab.listMessages, {
      threadId: created.threadId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(messages.page).toHaveLength(1);
    expect(messages.page[0]).toMatchObject({
      role: "user",
      text: "Say hello.",
      parts: [{ type: "text", text: "Say hello." }],
    });

    const secondUserId = await insertUser(backend, ADMIN_EMAIL);
    const secondAdmin = backend.withIdentity({ subject: `${secondUserId}|other-session` });
    await expect(
      secondAdmin.query(api.scout.lab.listMessages, {
        threadId: created.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow("Thread not found");
  });
});
