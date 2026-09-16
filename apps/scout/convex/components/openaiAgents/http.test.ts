/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import schema from "./schema";
import { presentItem } from "./provider";

const modules = import.meta.glob("./**/*.ts");
const secret = btoa("component-test-signing-secret");
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_WEBHOOK_SECRET", `whsec_${secret}`);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function signed(payload: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(atob(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`delivery-1.${timestamp}.${payload}`),
  );
  return {
    "webhook-id": "delivery-1",
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${btoa(String.fromCharCode(...new Uint8Array(signature)))}`,
    "Content-Type": "application/json",
  };
}

it("verifies the raw body and records duplicate deliveries only once", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await t.mutation(api.state.register, {
    sessionKey: "app-session",
    runKey: "run",
    onEvent: "unused-callback",
  });
  await t.run((ctx) => ctx.db.patch(sessionId, { providerId: "provider-session" }));
  const payload = JSON.stringify({
    id: "event-1",
    type: "agent.session.action_required",
    data: { id: "provider-session", required_action: { type: "function_call" } },
  });
  const headers = await signed(payload);
  const first = await t.fetch("/webhook", { method: "POST", headers, body: payload });
  const second = await t.fetch("/webhook", { method: "POST", headers, body: payload });
  expect(first.status).toBe(204);
  expect(second.status).toBe(204);
  const session = await t.query(api.state.get, { sessionKey: "app-session" });
  expect(session?.revision).toBe(1);
  expect(await t.run((ctx) => ctx.db.query("webhooks").take(10))).toHaveLength(1);
});

it("rejects altered bodies, expired signatures, and invalid event shapes", async () => {
  const t = convexTest(schema, modules);
  const payload = JSON.stringify({
    id: "event-1",
    type: "agent.session.idle",
    data: { id: "provider-session" },
  });
  expect(
    (
      await t.fetch("/webhook", {
        method: "POST",
        headers: await signed(payload),
        body: `${payload} `,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await t.fetch("/webhook", {
        method: "POST",
        headers: await signed(payload, Math.floor(Date.now() / 1000) - 600),
        body: payload,
      })
    ).status,
  ).toBe(400);
  const malformed = JSON.stringify({ type: "agent.session.idle" });
  expect(
    (
      await t.fetch("/webhook", {
        method: "POST",
        headers: await signed(malformed),
        body: malformed,
      })
    ).status,
  ).toBe(400);
  expect(await t.run((ctx) => ctx.db.query("webhooks").take(10))).toHaveLength(0);
});

it("acknowledges events for sessions owned by other deployments without scheduling work", async () => {
  const t = convexTest(schema, modules);
  const payload = JSON.stringify({
    id: "event-other",
    type: "agent.session.idle",
    data: { id: "other-session" },
  });
  expect(
    (await t.fetch("/webhook", { method: "POST", headers: await signed(payload), body: payload }))
      .status,
  ).toBe(204);
  expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(10))).toHaveLength(
    0,
  );
});

it("rejects unknown provider items and retains completed failed tool results", () => {
  expect(() => presentItem({ id: "x", type: "unexpected", status: "completed" })).toThrow();
  expect(
    presentItem({
      id: "tool-result",
      type: "function_call_output",
      status: "failed",
      error: "Browser unavailable",
    }),
  ).toMatchObject({ complete: true, text: "Browser unavailable" });
});
