/// <reference types="vite/client" />
import { R2 } from "@convex-dev/r2";
import { convexTest } from "convex-test";
import { Firecrawl } from "firecrawl";
import { chromium } from "playwright-core";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import type { BrowserScreenshot } from "../scout/playwrightBrowser";
import { ADMIN_EMAIL, insertTestAccount } from "../testing/accounts";
import { MAX_SCREENSHOT_BYTES } from "./screenshotModel";
import { saveScreenshot } from "./screenshots";
import { executeTaskTool } from "./execution";

const modules = {
  ...import.meta.glob("../**/*.ts"),
  ...Object.fromEntries(
    Object.entries(import.meta.glob("./*.ts")).map(([path, module]) => [
      `../tasks/${path.slice(2)}`,
      module,
    ]),
  ),
};
const signedUrl = "https://images.example.test/screenshot.png?signature=test";
const image: BrowserScreenshot = {
  bytes: Buffer.from("test screenshot"),
  metadata: {
    tabId: "tab-1",
    url: "https://example.test/result",
    title: "Calculation result",
    startedAtMs: 100,
    completedAtMs: 200,
    width: 2560,
    height: 1600,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 120 },
  },
};
const note = "The calculator shows the completed result.";
const getUrl = vi.fn<R2["getUrl"]>();
const store = vi.fn<R2["store"]>();
const deleteObject = vi.fn<R2["deleteObject"]>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T09:00:00Z"));
  vi.stubEnv("CONVEX_CLOUD_URL", "https://screenshot-tests.convex.cloud");
  vi.stubEnv("R2_BUCKET", "test-bucket");
  vi.stubEnv("R2_ENDPOINT", "https://storage.example.test");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key");
  getUrl.mockReset().mockResolvedValue(signedUrl);
  store.mockReset().mockResolvedValue("stored-image");
  deleteObject.mockReset().mockResolvedValue(undefined);
  vi.spyOn(R2.prototype, "getUrl").mockImplementation(getUrl);
  vi.spyOn(R2.prototype, "store").mockImplementation(store);
  vi.spyOn(R2.prototype, "deleteObject").mockImplementation(deleteObject);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function setup(visibility: Doc<"scoutChats">["visibility"]) {
  const backend = convexTest(schema, modules);
  const accounts = await backend.run(async (ctx) => ({
    ownerId: await insertTestAccount(ctx, { email: "owner@example.test" }),
    otherId: await insertTestAccount(ctx, { email: "other@example.test" }),
    adminId: await insertTestAccount(ctx, { email: ADMIN_EMAIL }),
    scoutId: await ctx.db.insert("scouts", {
      displayName: "Scout",
      slug: "scout",
      status: "active",
      websiteIdentity: { firstName: "Scout", lastName: "Test" },
      agentMail: { inboxId: "test", address: "scout@example.test" },
      firecrawl: { profileName: "test-profile" },
    }),
  }));
  const createTask = () =>
    backend.run(async (ctx) => {
      const sessionId = await ctx.db.insert("agentsApiSessions", {
        userId: accounts.ownerId,
        scoutId: accounts.scoutId,
        scoutName: "Scout",
        title: "Test calculator",
        model: "gpt-5.6-luna",
        state: { kind: "running" },
        active: true,
        nextSequence: 0,
        browser: null,
        usage: null,
      });
      const chatId = await ctx.db.insert("scoutChats", {
        threadId: sessionId,
        runtime: { kind: "agents_api", sessionId },
        userId: accounts.ownerId,
        scoutId: accounts.scoutId,
        createdAt: Date.now(),
        purpose: { kind: "review" },
        visibility,
      });
      const checkId = await ctx.db.insert("agentsApiRequestChecks", {
        sessionId,
        kind: "initial",
        model: "gpt-5.6-luna",
        prompt: "Test https://example.test",
        state: {
          kind: "completed",
          finishedAt: Date.now(),
          call: { startedAt: Date.now(), request: "{}", response: "{}", usage: null },
          result: { kind: "initial", title: "Test calculator", decision: { kind: "approved" } },
        },
      });
      return { sessionId, chatId, checkId };
    });
  const task = await createTask();
  const open = (providerSessionId: string) =>
    backend.mutation(internal.tasks.browsers.open, {
      sessionId: task.sessionId,
      browser: {
        providerSessionId,
        cdpUrl: "wss://browser.example.test/private-connection",
        liveViewUrl: null,
        interactiveLiveViewUrl: null,
        currentUrl: null,
      },
    });
  const reserve = async (toolCallId: string, providerSessionId: string) => {
    await backend.mutation(internal.tasks.browsers.prepareOperation, {
      providerSessionId,
      toolCallId,
      action: { kind: "open", url: image.metadata.url },
    });
    return await backend.mutation(internal.tasks.screenshotRecords.prepare, {
      sessionId: task.sessionId,
      providerSessionId,
      toolCallId,
      note,
    });
  };
  const finish = (screenshotId: Id<"agentsApiScreenshots">) =>
    backend.mutation(internal.tasks.screenshotRecords.finish, {
      screenshotId,
      key: `private-images/${screenshotId}.png`,
      metadata: image.metadata,
    });
  const close = (providerSessionId: string) =>
    backend.mutation(internal.tasks.browsers.close, {
      providerSessionId,
      providerDurationMs: 1_000,
      creditsBilled: 1,
    });
  await open("browser-1");
  return {
    backend,
    owner: backend.withIdentity({ subject: accounts.ownerId }),
    other: backend.withIdentity({ subject: accounts.otherId }),
    admin: backend.withIdentity({ subject: accounts.adminId }),
    ...task,
    createTask,
    open,
    close,
    reserve,
    finish,
  };
}

it("lets a private task's owner and admin read metadata and sign its image", async () => {
  const t = await setup("private");
  const captureId = await t.reserve("capture-1", "browser-1");
  await t.finish(captureId);
  for (const viewer of [t.owner, t.admin]) {
    expect(await viewer.query(api.tasks.walkthrough.get, { sessionId: t.sessionId })).toEqual({
      walkthrough: null,
      captures: [
        {
          id: captureId,
          note,
          browserSequence: 1,
          operationSequence: 1,
          state: { kind: "ready", metadata: image.metadata },
        },
      ],
    });
    expect(
      await viewer.action(api.tasks.screenshots.imageUrl, { screenshotId: captureId }),
    ).toEqual({
      url: signedUrl,
      expiresAtMs: Date.now() + 900_000,
    });
  }
  expect(getUrl).toHaveBeenCalledTimes(2);
  expect(getUrl).toHaveBeenCalledWith(`private-images/${captureId}.png`, { expiresIn: 900 });
});

it("denies private metadata and image signing by capture ID to other users and anonymous viewers", async () => {
  const t = await setup("private");
  const captureId = await t.reserve("capture-1", "browser-1");
  await t.finish(captureId);
  for (const viewer of [t.other, t.backend]) {
    expect(await viewer.query(api.tasks.walkthrough.get, { sessionId: t.sessionId })).toBeNull();
    expect(
      await viewer.action(api.tasks.screenshots.imageUrl, { screenshotId: captureId }),
    ).toBeNull();
  }
  expect(getUrl).not.toHaveBeenCalled();
});

it("allows public task viewers and rechecks access after the task becomes private", async () => {
  const t = await setup("public");
  const captureId = await t.reserve("capture-1", "browser-1");
  await t.finish(captureId);
  for (const viewer of [t.other, t.backend]) {
    expect(await viewer.query(api.tasks.walkthrough.get, { sessionId: t.sessionId })).toMatchObject(
      {
        captures: [{ id: captureId, state: { kind: "ready", metadata: image.metadata } }],
      },
    );
    expect(
      await viewer.action(api.tasks.screenshots.imageUrl, { screenshotId: captureId }),
    ).toMatchObject({ url: signedUrl });
  }
  await t.backend.run((ctx) => ctx.db.patch(t.chatId, { visibility: "private" }));
  getUrl.mockClear();
  for (const viewer of [t.other, t.backend]) {
    expect(await viewer.query(api.tasks.walkthrough.get, { sessionId: t.sessionId })).toBeNull();
    expect(
      await viewer.action(api.tasks.screenshots.imageUrl, { screenshotId: captureId }),
    ).toBeNull();
  }
  expect(getUrl).not.toHaveBeenCalled();
});

it("does not expose a public task's screenshots while its initial request check is pending", async () => {
  const t = await setup("public");
  const captureId = await t.reserve("capture-1", "browser-1");
  await t.finish(captureId);
  await t.backend.run((ctx) => ctx.db.patch(t.checkId, { state: { kind: "pending" } }));
  for (const viewer of [t.other, t.backend]) {
    expect(await viewer.query(api.tasks.walkthrough.get, { sessionId: t.sessionId })).toBeNull();
    expect(
      await viewer.action(api.tasks.screenshots.imageUrl, { screenshotId: captureId }),
    ).toBeNull();
  }
  expect(getUrl).not.toHaveBeenCalled();
});

it("does not sign pending, failed, or deleted captures even for the owner", async () => {
  const t = await setup("private");
  const pending = await t.reserve("pending", "browser-1");
  const failed = await t.reserve("failed", "browser-1");
  const deleted = await t.reserve("deleted", "browser-1");
  await t.backend.mutation(internal.tasks.screenshotRecords.fail, {
    screenshotId: failed,
    message: "Capture failed",
  });
  await t.backend.run((ctx) => ctx.db.delete(deleted));
  for (const screenshotId of [pending, failed, deleted]) {
    expect(await t.owner.action(api.tasks.screenshots.imageUrl, { screenshotId })).toBeNull();
  }
  expect(getUrl).not.toHaveBeenCalled();
});

it("orders captures by browser and operation sequence despite reversed reservations and upload completion", async () => {
  const t = await setup("private");
  for (const toolCallId of ["first", "second"]) {
    await t.backend.mutation(internal.tasks.browsers.prepareOperation, {
      providerSessionId: "browser-1",
      toolCallId,
      action: { kind: "open", url: image.metadata.url },
    });
  }
  const second = await t.reserve("second", "browser-1");
  const first = await t.reserve("first", "browser-1");
  await t.close("browser-1");
  await t.open("browser-2");
  const third = await t.reserve("first", "browser-2");
  for (const id of [third, second, first]) {
    vi.advanceTimersByTime(100);
    await t.finish(id);
  }
  const captures = await t.backend.query(internal.tasks.walkthrough.listForAgent, {
    sessionId: t.sessionId,
  });
  expect(
    captures.map(({ id, browserSequence, operationSequence }) => ({
      id,
      browserSequence,
      operationSequence,
    })),
  ).toEqual([
    { id: first, browserSequence: 1, operationSequence: 1 },
    { id: second, browserSequence: 1, operationSequence: 2 },
    { id: third, browserSequence: 2, operationSequence: 1 },
  ]);
  expect(await t.owner.query(api.tasks.walkthrough.get, { sessionId: t.sessionId })).toEqual({
    walkthrough: null,
    captures,
  });
  expect(JSON.stringify(captures)).not.toContain("private-images");
});

it("rejects duplicate reservations without allocating another capture or replacing its note", async () => {
  const t = await setup("private");
  const captureId = await t.reserve("capture-1", "browser-1");
  const args = {
    sessionId: t.sessionId,
    providerSessionId: "browser-1",
    toolCallId: "capture-1",
    note: "Changed note",
  };
  await expect(t.backend.mutation(internal.tasks.screenshotRecords.prepare, args)).rejects.toThrow(
    "already requested",
  );
  await t.finish(captureId);
  await expect(t.backend.mutation(internal.tasks.screenshotRecords.prepare, args)).rejects.toThrow(
    "already requested",
  );
  expect(
    await t.backend.query(internal.tasks.walkthrough.listForAgent, { sessionId: t.sessionId }),
  ).toMatchObject([{ id: captureId, note }]);
  expect(await t.backend.run((ctx) => ctx.db.query("agentsApiScreenshots").collect())).toHaveLength(
    1,
  );
});

it("enforces the 20-capture task cap across browsers, including pending and failed reservations", async () => {
  const t = await setup("private");
  for (let index = 0; index < 20; index++) {
    const id = await t.reserve(`capture-${index}`, "browser-1");
    if (index % 3 === 0) await t.finish(id);
    if (index % 3 === 1)
      await t.backend.mutation(internal.tasks.screenshotRecords.fail, {
        screenshotId: id,
        message: "Capture failed",
      });
  }
  await t.close("browser-1");
  await t.open("browser-2");
  await expect(t.reserve("capture-21", "browser-2")).rejects.toThrow("20-screenshot limit");
  expect(await t.backend.run((ctx) => ctx.db.query("agentsApiScreenshots").collect())).toHaveLength(
    20,
  );
});

it("keeps ready and failed states terminal when completion or failure arrives again", async () => {
  const t = await setup("private");
  const ready = await t.reserve("ready", "browser-1");
  const failed = await t.reserve("failed", "browser-1");
  await t.finish(ready);
  const readyRecord = await t.backend.run((ctx) => ctx.db.get(ready));
  await t.backend.mutation(internal.tasks.screenshotRecords.fail, {
    screenshotId: ready,
    message: "Late failure",
  });
  await expect(t.finish(ready)).rejects.toThrow("not pending");
  await t.backend.mutation(internal.tasks.screenshotRecords.fail, {
    screenshotId: failed,
    message: "Original failure",
  });
  await t.backend.mutation(internal.tasks.screenshotRecords.fail, {
    screenshotId: failed,
    message: "Late failure",
  });
  await expect(t.finish(failed)).rejects.toThrow("not pending");
  expect(await t.backend.run((ctx) => ctx.db.get(ready))).toEqual(readyRecord);
  expect(await t.backend.run((ctx) => ctx.db.get(failed))).toMatchObject({
    state: { kind: "failed", message: "Original failure" },
  });
});

it("lists saved screenshots and saves their walkthrough while the browser cannot reconnect", async () => {
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl-key");
  const t = await setup("private");
  const captureId = await t.reserve("capture-1", "browser-1");
  await t.finish(captureId);
  const connect = vi.spyOn(chromium, "connectOverCDP").mockRejectedValue(new Error("CDP timeout"));
  const recovery = vi
    .spyOn(Firecrawl.prototype, "listBrowsers")
    .mockRejectedValue(new Error("Browser recovery unavailable"));
  const execute = (name: string, input: unknown) =>
    t.backend.action(async (ctx) => {
      const current = await ctx.runQuery(internal.tasks.sessions.runtime, {
        sessionId: t.sessionId,
      });
      return await executeTaskTool(ctx, {
        ...current,
        call: { name, callId: name, arguments: input },
      });
    });
  const listed = await execute("list_screenshots", {});
  if (listed.kind !== "success") throw new Error(listed.error);
  const captures: unknown = JSON.parse(listed.output);
  expect(captures).toEqual([
    {
      id: captureId,
      note,
      browserSequence: 1,
      operationSequence: 1,
      state: { kind: "ready", metadata: image.metadata },
    },
  ]);
  const report = {
    summary: "The calculator returned the expected result.",
    checks: [{ label: "Calculation", result: "passed", explanation: "The result matched." }],
    sections: [{ heading: "Result", explanation: note, captureIds: [captureId] }],
  };
  await expect(execute("save_walkthrough", report)).resolves.toEqual({
    kind: "success",
    output: JSON.stringify({ saved: true, sections: 1 }),
  });
  const session = await t.backend.run((ctx) => ctx.db.get(t.sessionId));
  expect(session?.walkthrough).toEqual(report);
  expect(session?.browser?.providerSessionId).toBe("browser-1");
  expect(connect).not.toHaveBeenCalled();
  expect(recovery).not.toHaveBeenCalled();
});

it("rejects invalid walkthrough references atomically and keeps the previous report", async () => {
  const t = await setup("private");
  const ready = await t.reserve("ready", "browser-1");
  await t.finish(ready);
  const pending = await t.reserve("pending", "browser-1");
  const failed = await t.reserve("failed", "browser-1");
  await t.backend.mutation(internal.tasks.screenshotRecords.fail, {
    screenshotId: failed,
    message: "Capture failed",
  });
  const foreign = await t.reserve("foreign", "browser-1");
  await t.finish(foreign);
  const otherTask = await t.createTask();
  await t.backend.run((ctx) => ctx.db.patch(foreign, { sessionId: otherTask.sessionId }));
  const deleted = await t.reserve("deleted", "browser-1");
  await t.backend.run((ctx) => ctx.db.delete(deleted));
  const section = {
    heading: "Result",
    explanation: "The calculator returns the correct sum.",
    captureIds: [ready],
  };
  const report = {
    summary: "Calculator walkthrough",
    checks: [
      { label: "Add two numbers", result: "passed" as const, explanation: "The sum was correct." },
    ],
    sections: [section],
  };
  expect(
    await t.backend.mutation(internal.tasks.walkthrough.save, {
      sessionId: t.sessionId,
      ...report,
    }),
  ).toBeNull();
  for (const invalid of [pending, failed, foreign, deleted, "not-a-convex-id", t.sessionId]) {
    await expect(
      t.backend.mutation(internal.tasks.walkthrough.save, {
        sessionId: t.sessionId,
        summary: "Replacement",
        checks: report.checks,
        sections: [section, { ...section, captureIds: [invalid] }],
      }),
    ).rejects.toThrow(/Invalid screenshot ID|Use only completed screenshots from this task/);
    expect((await t.backend.run((ctx) => ctx.db.get(t.sessionId)))?.walkthrough).toEqual(report);
  }
  await expect(
    t.backend.mutation(internal.tasks.walkthrough.save, {
      sessionId: t.sessionId,
      ...report,
      sections: [{ ...section, captureIds: [ready, ready] }],
    }),
  ).rejects.toThrow("Do not repeat a screenshot within a section");
  await expect(
    t.backend.mutation(internal.tasks.walkthrough.save, {
      sessionId: t.sessionId,
      ...report,
      checks: [],
    }),
  ).rejects.toThrow();
  expect((await t.backend.run((ctx) => ctx.db.get(t.sessionId)))?.walkthrough).toEqual(report);
});

it("retains report references and renewable image access after browser closure and task completion", async () => {
  const t = await setup("public");
  const first = await t.reserve("first", "browser-1");
  const second = await t.reserve("second", "browser-1");
  await t.finish(first);
  await t.finish(second);
  await t.close("browser-1");
  const report = {
    summary: "The calculator works.",
    checks: [
      { label: "Add two numbers", result: "passed" as const, explanation: "The sum was correct." },
      {
        label: "Export the result",
        result: "untested" as const,
        explanation: "Export requires a paid plan.",
      },
    ],
    sections: [
      {
        heading: "Result",
        explanation: "The final result is correct.",
        captureIds: [second, first],
      },
      {
        heading: "Starting point",
        explanation: "The form accepts both values.",
        captureIds: [first],
      },
    ],
  };
  await t.backend.mutation(internal.tasks.walkthrough.save, {
    sessionId: t.sessionId,
    ...report,
  });
  await t.backend.run((ctx) =>
    ctx.db.patch(t.sessionId, { state: { kind: "idle" }, active: false }),
  );
  expect((await t.backend.run((ctx) => ctx.db.get(t.sessionId)))?.browser).toBeNull();
  const view = await t.backend.query(api.tasks.walkthrough.get, { sessionId: t.sessionId });
  expect(view?.walkthrough).toEqual(report);
  expect(view?.captures.map(({ id }) => id)).toEqual([first, second]);
  expect(await t.backend.action(api.tasks.screenshots.imageUrl, { screenshotId: second })).toEqual({
    url: signedUrl,
    expiresAtMs: Date.now() + 900_000,
  });
  vi.advanceTimersByTime(900_001);
  getUrl.mockResolvedValueOnce("https://images.example.test/screenshot.png?signature=renewed");
  expect(await t.backend.action(api.tasks.screenshots.imageUrl, { screenshotId: second })).toEqual({
    url: "https://images.example.test/screenshot.png?signature=renewed",
    expiresAtMs: Date.now() + 900_000,
  });
  expect(getUrl).toHaveBeenCalledTimes(2);
  expect(deleteObject).not.toHaveBeenCalled();
  expect((await t.backend.run((ctx) => ctx.db.get(t.sessionId)))?.walkthrough).toEqual(report);
});

it.each<{
  failure: "capture" | "upload" | "oversized" | "cleanup";
  message: string;
}>([
  { failure: "capture", message: "Capture failed" },
  { failure: "upload", message: "Upload failed" },
  { failure: "oversized", message: "Screenshot exceeds the image size limit" },
  { failure: "cleanup", message: "Upload failed Image cleanup also failed: Cleanup failed" },
])(
  "records $failure failure without repeating the capture callback",
  async ({ failure, message }) => {
    const t = await setup("private");
    await t.backend.mutation(internal.tasks.browsers.prepareOperation, {
      providerSessionId: "browser-1",
      toolCallId: "capture-1",
      action: { kind: "open", url: image.metadata.url },
    });
    const take = vi.fn<() => Promise<BrowserScreenshot>>().mockResolvedValue(image);
    switch (failure) {
      case "capture":
        take.mockRejectedValue(new Error("Capture failed"));
        break;
      case "upload":
        store.mockRejectedValue(new Error("Upload failed"));
        break;
      case "oversized":
        take.mockResolvedValue({ ...image, bytes: Buffer.alloc(MAX_SCREENSHOT_BYTES + 1) });
        break;
      case "cleanup":
        store.mockRejectedValue(new Error("Upload failed"));
        deleteObject.mockRejectedValue(new Error("Cleanup failed"));
        break;
      default: {
        const exhaustive: never = failure;
        return exhaustive;
      }
    }
    const result = await t.backend.action((ctx) =>
      saveScreenshot(ctx, {
        sessionId: t.sessionId,
        providerSessionId: "browser-1",
        toolCallId: "capture-1",
        note,
        take,
      }),
    );
    expect(result.kind).toBe("failed");
    const capture = await t.backend.run((ctx) => ctx.db.query("agentsApiScreenshots").unique());
    expect(capture?.state).toEqual({ kind: "failed", message });
    expect(result).toEqual({ kind: "failed", message });
    expect(take).toHaveBeenCalledTimes(1);
    if (failure === "upload" || failure === "cleanup") {
      expect(store).toHaveBeenCalledTimes(1);
      expect(deleteObject).toHaveBeenCalledTimes(1);
      expect(deleteObject).toHaveBeenCalledWith(
        expect.anything(),
        `deployments/screenshot-tests.convex.cloud/tasks/${t.sessionId}/screenshots/${capture?._id}.png`,
      );
    } else {
      expect(store).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    }
    expect(getUrl).not.toHaveBeenCalled();
  },
);

it("reserves before taking the image and persists its metadata only after upload", async () => {
  const t = await setup("private");
  await t.backend.mutation(internal.tasks.browsers.prepareOperation, {
    providerSessionId: "browser-1",
    toolCallId: "capture-1",
    action: { kind: "open", url: image.metadata.url },
  });
  const take = vi.fn<() => Promise<BrowserScreenshot>>().mockImplementation(async () => {
    expect(
      await t.backend.run((ctx) => ctx.db.query("agentsApiScreenshots").unique()),
    ).toMatchObject({ state: { kind: "pending" } });
    expect(store).not.toHaveBeenCalled();
    return image;
  });
  store.mockImplementation(async () => {
    expect(
      await t.backend.run((ctx) => ctx.db.query("agentsApiScreenshots").unique()),
    ).toMatchObject({ state: { kind: "pending" } });
    return "stored-image";
  });
  const result = await t.backend.action((ctx) =>
    saveScreenshot(ctx, {
      sessionId: t.sessionId,
      providerSessionId: "browser-1",
      toolCallId: "capture-1",
      note,
      take,
    }),
  );
  expect(result).toMatchObject({ kind: "ready", note, metadata: image.metadata });
  const capture = await t.backend.run((ctx) => ctx.db.query("agentsApiScreenshots").unique());
  const key = `deployments/screenshot-tests.convex.cloud/tasks/${t.sessionId}/screenshots/${capture?._id}.png`;
  expect(capture?.state).toEqual({ kind: "ready", key, metadata: image.metadata });
  expect(store).toHaveBeenCalledWith(expect.anything(), image.bytes, {
    key,
    type: "image/png",
    disposition: "inline",
  });
  await expect(
    t.backend.action((ctx) =>
      saveScreenshot(ctx, {
        sessionId: t.sessionId,
        providerSessionId: "browser-1",
        toolCallId: "capture-1",
        note,
        take,
      }),
    ),
  ).rejects.toThrow("already requested");
  expect(take).toHaveBeenCalledTimes(1);
  expect(store).toHaveBeenCalledTimes(1);
  expect(deleteObject).not.toHaveBeenCalled();
});
