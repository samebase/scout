/// <reference types="vite/client" />

import { R2 } from "@convex-dev/r2";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { ADMIN_EMAIL, insertTestAccount } from "./testing/accounts";
import schema from "./schema";
import {
  bashResultSchema,
  MAX_WORKSPACE_BYTES,
  MAX_WORKSPACE_ENTRIES,
  MAX_WORKSPACE_FILE_BYTES,
  type WorkspaceEntry,
  type WorkspaceTarget,
} from "./workspaceModel";
import { requireRuntimeTool } from "./scout/lib/runtimeTool";
import { createWorkspaceTools, saveWorkspaceFile } from "./scout/workspaceTools";
import { runtimeTools } from "./tasks/tools";
import type { Doc, Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const blobs = new Map<string, Uint8Array>();
const deleted: string[] = [];

beforeEach(() => {
  blobs.clear();
  deleted.length = 0;
  vi.stubEnv("R2_BUCKET", "workspace-test");
  vi.stubEnv("R2_ENDPOINT", "https://storage.example.test");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://workspace-test.convex.cloud");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  vi.spyOn(R2.prototype, "store").mockImplementation(async (_ctx, file, options) => {
    const key = typeof options === "string" ? options : options?.key;
    if (!key) throw new Error("Expected an explicitly scoped key");
    blobs.set(key, file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file);
    return key;
  });
  vi.spyOn(R2.prototype, "getUrl").mockImplementation(
    async (key) => `https://storage.example.test/${key}`,
  );
  vi.spyOn(R2.prototype, "deleteObject").mockImplementation(async (_ctx, key) => {
    deleted.push(key);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const bytes = blobs.get(url.pathname.slice(1));
      return bytes
        ? new Response(new Uint8Array(bytes), { status: 200 })
        : new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(["agents_api", "convex_agent"] satisfies Array<Doc<"agentsApiSessions">["engine"]>)(
  "%s workspaces",
  (engine) => {
    async function setup() {
      const backend = convexTest(schema, modules);
      const userId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
      const otherId = await backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
      const scoutId = await backend.run((ctx) =>
        ctx.db.insert("scouts", {
          displayName: "Workspace Scout",
          websiteIdentity: { firstName: "Workspace", lastName: "Scout" },
          slug: "workspace",
          status: "active",
          agentMail: { inboxId: "test-inbox", address: "scout@example.test" },
          firecrawl: { profileName: "workspace-profile" },
        }),
      );
      const owner = backend.withIdentity({ subject: `${userId}|session` });
      const other = backend.withIdentity({ subject: `${otherId}|session` });
      const makeSession = (
        ownerId: Id<"users">,
        scout: Id<"scouts">,
        purpose: "general" | "review",
      ) =>
        backend.run(async (ctx) => {
          const sessionId = await ctx.db.insert("agentsApiSessions", {
            engine,
            userId: ownerId,
            scoutId: scout,
            scoutName: "Workspace Scout",
            title: "Research",
            model: "gpt-5.6-luna",
            active: true,
            state: { kind: "running" },
            nextSequence: 0,
            usage: null,
            browser: {
              providerSessionId: "browser-test",
              cdpUrl: "wss://browser.example.test/cdp",
              liveViewUrl: null,
              interactiveLiveViewUrl: null,
              currentUrl: null,
            },
          });
          if (purpose === "review")
            await ctx.db.insert("scoutChats", {
              threadId: sessionId,
              userId: ownerId,
              scoutId: scout,
              createdAt: Date.now(),
              runtime: { kind: "agents_api", sessionId },
              purpose: { kind: "review" },
              visibility: "private",
            });
          return sessionId;
        });
      const sessionId = await makeSession(userId, scoutId, "general");
      const otherSessionId = await makeSession(otherId, scoutId, "general");
      const runSession = (id: Id<"agentsApiSessions">, command: string, workspace?: string) =>
        backend.action(async (ctx) => {
          const data = await ctx.runQuery(internal.tasks.sessions.runtime, { sessionId: id });
          const resource = await runtimeTools(ctx, data.session, data.scout, "bash", data.purpose);
          try {
            return bashResultSchema.parse(
              await requireRuntimeTool(resource.tools, "bash").execute(
                { command, workspace },
                { toolCallId: crypto.randomUUID(), messages: [], context: {} },
              ),
            );
          } finally {
            await resource.dispose();
          }
        });
      const run = (command: string, workspace?: string) =>
        runSession(sessionId, command, workspace);
      return {
        backend,
        owner,
        other,
        userId,
        otherId,
        scoutId,
        sessionId,
        otherSessionId,
        makeSession,
        runSession,
        run,
      };
    }

    describe("task runtime workspaces", () => {
      it.each(["general", "review"] satisfies Array<"general" | "review">)(
        "persists %s session files and shares site files through the real tools",
        async (purpose) => {
          const t = await setup();
          const userId =
            purpose === "general"
              ? t.userId
              : await t.backend.run((ctx) =>
                  insertTestAccount(ctx, { email: "member@example.test" }),
                );
          const sessionId = await t.makeSession(userId, t.scoutId, purpose);
          const secondSession = await t.makeSession(userId, t.scoutId, purpose);
          const run = t.runSession;
          expect(
            await run(sessionId, "mkdir notes; cd notes; printf private > result.txt"),
          ).toMatchObject({ exitCode: 0 });
          expect(await run(sessionId, "cat result.txt")).toMatchObject({
            stdout: "private",
            cwd: "/workspace/notes",
          });
          expect(await run(secondSession, "test ! -e notes/result.txt")).toMatchObject({
            exitCode: 0,
          });
          expect(
            await run(sessionId, "printf 'Public rules' > guide.md", "Example.com"),
          ).toMatchObject({ exitCode: 0 });
          expect(await run(secondSession, "cat guide.md", "example.com")).toMatchObject({
            stdout: "Public rules",
          });
          const target = { kind: "agent_session", sessionId } satisfies WorkspaceTarget;
          const listed = await t.owner.query(api.scout.workspaces.list, { target });
          expect(listed.entries.find((entry) => entry.kind === "file")).toMatchObject({
            key: expect.stringContaining(
              `/users/${userId}/agent-sessions/${sessionId}/files/notes/result.txt/`,
            ),
          });
          expect(
            await t.owner.action(api.scout.workspaceTools.readFile, {
              target,
              path: "/workspace/notes/result.txt",
            }),
          ).toMatchObject({ text: "private" });
          expect(
            await t.owner.action(api.scout.workspaceTools.readFile, {
              target: { kind: "site", site: "example.com" },
              path: "/workspace/guide.md",
            }),
          ).toMatchObject({ text: "Public rules" });
          await expect(t.backend.query(api.scout.workspaces.list, { target })).rejects.toThrow(
            "Not authorized",
          );
          const outsiderId = await t.backend.run((ctx) =>
            insertTestAccount(ctx, { email: "outsider@example.test" }),
          );
          const outsider = t.backend.withIdentity({ subject: `${outsiderId}|session` });
          await expect(outsider.query(api.scout.workspaces.list, { target })).rejects.toThrow(
            "Not authorized",
          );
          await expect(
            outsider.action(api.scout.workspaceTools.readFile, {
              target,
              path: "/workspace/notes/result.txt",
            }),
          ).rejects.toThrow("Not authorized");
          await expect(
            t.backend.mutation(internal.scout.workspaces.snapshot, { target, userId: outsiderId }),
          ).rejects.toThrow("Session not found");
          await expect(
            t.backend.mutation(internal.scout.workspaces.commit, {
              workspaceId: (
                await t.backend.mutation(internal.scout.workspaces.snapshot, { target, userId })
              ).workspaceId,
              userId: t.otherId,
              expectedRevision: listed.revision,
              cwd: "/workspace",
              entries: [],
            }),
          ).rejects.toThrow("Session not found");
          await t.backend.run((ctx) => ctx.db.patch(sessionId, { state: { kind: "stopped" } }));
          await expect(run(sessionId, "printf should-not-write > stopped.txt")).rejects.toThrow(
            "no longer running",
          );
          await t.backend.run(async (ctx) => {
            await ctx.db.patch(sessionId, { active: false });
            await ctx.db.patch(secondSession, { active: false, state: { kind: "idle" } });
          });
          expect(await t.run("cat guide.md", "example.com")).toMatchObject({
            stdout: "Public rules",
          });
        },
      );
    });

    describe("workspace persistence and access", () => {
      it("writes under owner/session prefixes and reloads files through the task tool and viewer", async () => {
        const { owner, userId, sessionId, run } = await setup();
        const first = await run("mkdir -p reports; cd reports; printf 'hello\\n' > hello.txt");
        expect(first.exitCode).toBe(0);
        const workspace = await owner.query(api.scout.workspaces.list, {
          target: { kind: "agent_session", sessionId },
        });
        expect(workspace.cwd).toBe("/workspace/reports");
        expect(workspace.entries.find((entry) => entry.kind === "file")).toMatchObject({
          key: expect.stringContaining(`/users/${userId}/agent-sessions/${sessionId}/files/`),
        });
        expect([...blobs.keys()][0]).toMatch(/\/files\/reports\/hello\.txt\/[a-f0-9-]{36}$/);
        const preview = await owner.action(api.scout.workspaceTools.readFile, {
          target: { kind: "agent_session", sessionId },
          path: "/workspace/reports/hello.txt",
        });
        expect(preview.text).toBe("hello\n");
        expect(new Uint8Array(preview.bytes)).toEqual(new TextEncoder().encode("hello\n"));
        expect(preview).not.toHaveProperty("url");
        const second = await run("cat hello.txt");
        expect(second).toMatchObject({
          stdout: "hello\n",
          revision: 1,
        });
        expect(blobs.size).toBe(1);
      });

      it("allows admin inspection but rejects non-owner writes and member or anonymous reads", async () => {
        const { backend, other, otherId, sessionId, otherSessionId, run } = await setup();
        await run("printf private > secret.txt");
        const target = { kind: "agent_session", sessionId } satisfies WorkspaceTarget;
        expect(await other.query(api.scout.workspaces.list, { target })).toMatchObject({
          entries: expect.arrayContaining([
            expect.objectContaining({ path: "/workspace/secret.txt" }),
          ]),
        });
        expect(
          await other.action(api.scout.workspaceTools.readFile, {
            target,
            path: "/workspace/secret.txt",
          }),
        ).toMatchObject({ text: "private" });
        const before = await other.query(api.scout.workspaces.list, { target });
        await expect(
          backend.mutation(internal.scout.workspaces.snapshot, {
            target,
            userId: otherId,
          }),
        ).rejects.toThrow("Session not found");
        await expect(
          other.action((ctx) =>
            saveWorkspaceFile(ctx, {
              target,
              userId: otherId,
              path: "/workspace/secret.txt",
              text: "overwrite",
            }),
          ),
        ).rejects.toThrow("Session not found");
        expect(await other.query(api.scout.workspaces.list, { target })).toEqual(before);
        expect(
          (
            await other.query(api.scout.workspaces.list, {
              target: { kind: "agent_session", sessionId: otherSessionId },
            })
          ).entries,
        ).toEqual([]);
        await backend.run((ctx) => ctx.db.patch(otherId, { email: "member@example.test" }));
        for (const caller of [other, backend]) {
          await expect(caller.query(api.scout.workspaces.list, { target })).rejects.toThrow(
            "Not authorized",
          );
          await expect(
            caller.action(api.scout.workspaceTools.readFile, {
              target,
              path: "/workspace/secret.txt",
            }),
          ).rejects.toThrow("Not authorized");
        }
      });

      it("persists TypeScript-generated files in R2 and isolates them from other sessions", async () => {
        const { owner, sessionId, otherSessionId, userId, run, runSession } = await setup();
        const result = await run(`cat > report.ts <<'TS'
import { writeFileSync } from "node:fs";
const scores: number[] = [8, 9];
writeFileSync("/workspace/report.json", JSON.stringify({ total: scores.reduce((a, b) => a + b, 0) }));
TS
js-exec report.ts`);
        expect(result.exitCode).toBe(0);
        expect([...blobs.keys()]).toContainEqual(
          expect.stringMatching(
            new RegExp(
              `^deployments/workspace-test\\.convex\\.cloud/users/${userId}/agent-sessions/${sessionId}/files/report\\.json/[a-f0-9-]{36}$`,
            ),
          ),
        );
        expect(
          await owner.action(api.scout.workspaceTools.readFile, {
            target: { kind: "agent_session", sessionId },
            path: "/workspace/report.json",
          }),
        ).toMatchObject({ text: '{"total":17}' });
        const reloaded = await run(
          `js-exec -c 'console.log(require("fs").readFileSync("report.json", "utf8"))'`,
        );
        expect(reloaded).toMatchObject({
          exitCode: 0,
          stdout: '{"total":17}\n',
        });
        expect(await runSession(otherSessionId, "test ! -e report.json")).toMatchObject({
          exitCode: 0,
        });
      });

      it("keeps the prior files and revision when R2 refuses a write", async () => {
        const { owner, sessionId, run } = await setup();
        await run("printf original > report.txt");
        const before = await owner.query(api.scout.workspaces.list, {
          target: { kind: "agent_session", sessionId },
        });
        vi.spyOn(R2.prototype, "store").mockRejectedValueOnce(new Error("R2 write failed"));
        await expect(run("printf changed > report.txt")).rejects.toThrow("R2 write failed");
        expect(
          await owner.query(api.scout.workspaces.list, {
            target: { kind: "agent_session", sessionId },
          }),
        ).toEqual(before);
        expect(
          (
            await owner.action(api.scout.workspaceTools.readFile, {
              target: { kind: "agent_session", sessionId },
              path: "/workspace/report.txt",
            })
          ).text,
        ).toBe("original");
        expect(deleted).toEqual([]);
      });

      it("preserves the workspace when lab access is revoked during a Bash upload", async () => {
        const { backend, owner, userId, sessionId, run } = await setup();
        await run("printf original > report.txt; printf keep > keep.txt");
        const before = await owner.query(api.scout.workspaces.list, {
          target: { kind: "agent_session", sessionId },
        });
        vi.spyOn(R2.prototype, "store").mockImplementationOnce(async (_ctx, file, options) => {
          const key = typeof options === "string" ? options : options?.key;
          if (!key) throw new Error("Expected an explicitly scoped key");
          blobs.set(key, file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file);
          await backend.run((ctx) =>
            ctx.db.patch(userId, { email: "member@example.test", isApproved: true }),
          );
          return key;
        });
        await expect(
          run("printf replacement > report.txt; rm keep.txt; mkdir reports; cd reports"),
        ).rejects.toThrow("Not authorized");
        await backend.run((ctx) => ctx.db.patch(userId, { email: ADMIN_EMAIL }));
        expect(
          await owner.query(api.scout.workspaces.list, {
            target: { kind: "agent_session", sessionId },
          }),
        ).toEqual(before);
        expect(
          await owner.action(api.scout.workspaceTools.readFile, {
            target: { kind: "agent_session", sessionId },
            path: "/workspace/report.txt",
          }),
        ).toMatchObject({ text: "original" });
        expect(deleted).toEqual([]);
      });

      it("preserves the workspace when session ownership changes during a Bash upload", async () => {
        const { backend, owner, other, otherId, sessionId, run } = await setup();
        await run("printf original > report.txt; printf keep > keep.txt");
        const before = await owner.query(api.scout.workspaces.list, {
          target: { kind: "agent_session", sessionId },
        });
        vi.spyOn(R2.prototype, "store").mockImplementationOnce(async (_ctx, file, options) => {
          const key = typeof options === "string" ? options : options?.key;
          if (!key) throw new Error("Expected an explicitly scoped key");
          blobs.set(key, file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file);
          await backend.run((ctx) => ctx.db.patch(sessionId, { userId: otherId }));
          return key;
        });
        await expect(
          run("printf replacement > report.txt; rm keep.txt; mkdir reports; cd reports"),
        ).rejects.toThrow("Session not found");
        expect(
          await other.query(api.scout.workspaces.list, {
            target: { kind: "agent_session", sessionId },
          }),
        ).toEqual(before);
        expect(
          await other.action(api.scout.workspaceTools.readFile, {
            target: { kind: "agent_session", sessionId },
            path: "/workspace/report.txt",
          }),
        ).toMatchObject({ text: "original" });
        expect(deleted).toEqual([]);
      });

      it.each(["member", "unverified", "deleted"])(
        "denies existing workspace access when its owner becomes %s",
        async (state) => {
          const { backend, owner, userId, sessionId, run } = await setup();
          await run("printf private > secret.txt");
          await backend.run(async (ctx) => {
            if (state === "member") {
              await ctx.db.patch(userId, { email: "member@example.test", isApproved: true });
            } else if (state === "unverified") {
              await ctx.db.patch(userId, { emailVerificationTime: undefined });
            } else {
              await ctx.db.replace(userId, { state: "deleted", deletedAt: Date.now() });
            }
          });
          await expect(
            owner.query(api.scout.workspaces.list, {
              target: { kind: "agent_session", sessionId },
            }),
          ).rejects.toThrow("Not authorized");
          await expect(
            owner.action(api.scout.workspaceTools.readFile, {
              target: { kind: "agent_session", sessionId },
              path: "/workspace/secret.txt",
            }),
          ).rejects.toThrow("Not authorized");
          await expect(
            backend.mutation(internal.scout.workspaces.snapshot, {
              target: { kind: "agent_session", sessionId },
              userId,
            }),
          ).rejects.toThrow("Not authorized");
          await expect(run("cat secret.txt")).rejects.toThrow("Not authorized");
        },
      );

      it("rejects a stale commit and schedules cleanup only after a successful replacement", async () => {
        const { backend, owner, sessionId, userId, run } = await setup();
        await run("printf original > report.txt");
        const stale = await backend.mutation(internal.scout.workspaces.snapshot, {
          target: { kind: "agent_session", sessionId },
          userId,
        });
        await run("printf replacement > report.txt");
        const current = await owner.query(api.scout.workspaces.list, {
          target: { kind: "agent_session", sessionId },
        });
        const originalFile = stale.entries.find((entry) => entry.kind === "file");
        const replacementFile = current.entries.find((entry) => entry.kind === "file");
        if (originalFile?.kind !== "file" || replacementFile?.kind !== "file")
          throw new Error("Expected both saved file versions");
        expect(originalFile.key).toMatch(/\/files\/report\.txt\/[a-f0-9-]{36}$/);
        expect(replacementFile.key).toMatch(/\/files\/report\.txt\/[a-f0-9-]{36}$/);
        expect(replacementFile.key).not.toBe(originalFile.key);
        await expect(
          backend.mutation(internal.scout.workspaces.commit, {
            workspaceId: stale.workspaceId,
            userId,
            expectedRevision: stale.revision,
            entries: stale.entries,
            cwd: stale.cwd,
          }),
        ).rejects.toThrow("Another command");
        expect(
          await owner.query(api.scout.workspaces.list, {
            target: { kind: "agent_session", sessionId },
          }),
        ).toEqual(current);
        expect(deleted).toEqual([originalFile.key]);
        await run("rm report.txt");
        expect(deleted).toEqual([originalFile.key, replacementFile.key]);
      });

      it("returns exact binary bytes for download without a text preview", async () => {
        const { owner, sessionId, run } = await setup();
        await run("printf /wAB | base64 -d > bytes.bin");
        const file = await owner.action(api.scout.workspaceTools.readFile, {
          target: { kind: "agent_session", sessionId },
          path: "/workspace/bytes.bin",
        });
        expect(file.text).toBeNull();
        expect(new Uint8Array(file.bytes)).toEqual(new Uint8Array([255, 0, 1]));
      });

      it.each(["corrupt", "modified"])(
        "rejects missing or corrupt bytes in both shell and preview reads: %s",
        async (corrupted) => {
          const { owner, sessionId, run } = await setup();
          await run("printf original > report.txt");
          const before = await owner.query(api.scout.workspaces.list, {
            target: { kind: "agent_session", sessionId },
          });
          for (const key of blobs.keys()) blobs.set(key, new TextEncoder().encode(corrupted));
          await expect(
            owner.action(api.scout.workspaceTools.readFile, {
              target: { kind: "agent_session", sessionId },
              path: "/workspace/report.txt",
            }),
          ).rejects.toThrow("integrity");
          await expect(run("cat report.txt")).rejects.toThrow("integrity");
          blobs.clear();
          await expect(
            owner.action(api.scout.workspaceTools.readFile, {
              target: { kind: "agent_session", sessionId },
              path: "/workspace/report.txt",
            }),
          ).rejects.toThrow("404");
          await expect(run("cat report.txt")).rejects.toThrow("404");
          expect(
            await owner.query(api.scout.workspaces.list, {
              target: { kind: "agent_session", sessionId },
            }),
          ).toEqual(before);
        },
      );
    });

    describe("shared site workspaces", () => {
      it("reuses files across users, Scouts, and tasks while keeping private files separate", async () => {
        const t = await setup();
        const secondScoutId = await t.backend.run(async (ctx) => {
          const scout = await ctx.db.get(t.scoutId);
          if (!scout) throw new Error("Missing Scout");
          const { _id, _creationTime, ...fields } = scout;
          return ctx.db.insert("scouts", { ...fields, slug: "second-workspace-scout" });
        });
        const secondSessionId = await t.makeSession(t.otherId, secondScoutId, "general");
        const shared = await t.run(
          "printf 'const size = 9; console.log(size);' > board.ts",
          "PaperGames.io",
        );
        expect(shared.exitCode).toBe(0);
        await t.run("printf private > secret.txt");
        const output = await t.other.action(async (ctx) => {
          const tools = createWorkspaceTools(
            ctx,
            { target: { kind: "agent_session", sessionId: secondSessionId }, userId: t.otherId },
            async () => {},
          );
          return requireRuntimeTool(tools, "bash").execute(
            {
              workspace: "papergames.io",
              command: "js-exec board.ts",
            },
            { toolCallId: "shared-read", messages: [], context: {} },
          );
        });
        expect(bashResultSchema.parse(output).stderr).toBe("");
        expect(output).toMatchObject({
          stdout: "9\n",
          exitCode: 0,
          workspace: "papergames.io",
          revision: 1,
        });
        const site = await t.other.query(api.scout.workspaces.list, {
          target: { kind: "site", site: "papergames.io" },
        });
        expect(site.entries.filter((entry) => entry.kind === "file")).toHaveLength(1);
        expect(site.entries.find((entry) => entry.kind === "file")).toMatchObject({
          key: expect.stringMatching(/\/sites\/papergames\.io\/files\/board\.ts\//),
        });
        expect(
          (
            await t.other.action(api.scout.workspaceTools.readFile, {
              target: { kind: "site", site: "papergames.io" },
              path: "/workspace/board.ts",
            })
          ).text,
        ).toContain("size = 9");
        expect(
          (
            await t.owner.query(api.scout.workspaces.list, {
              target: { kind: "agent_session", sessionId: t.sessionId },
            })
          ).entries.filter((entry) => entry.kind === "file"),
        ).toEqual([expect.objectContaining({ path: "/workspace/secret.txt" })]);
        expect(
          (
            await t.other.query(api.scout.workspaces.list, {
              target: { kind: "agent_session", sessionId: secondSessionId },
            })
          ).entries,
        ).toEqual([]);
        expect(
          (
            await t.owner.query(api.scout.workspaces.list, {
              target: { kind: "site", site: "another.example" },
            })
          ).entries,
        ).toEqual([]);
        await expect(
          t.other.action(api.scout.workspaceTools.readFile, {
            target: { kind: "site", site: "papergames.io" },
            path: "/workspace/secret.txt",
          }),
        ).rejects.toThrow("File not found");
      });

      it("requires current access to read or commit shared files", async () => {
        const t = await setup();
        await t.run("echo shared > guide.md", "example.com");
        await expect(
          t.backend.query(api.scout.workspaces.list, {
            target: { kind: "site", site: "example.com" },
          }),
        ).rejects.toThrow("Not authorized");
        const snapshot = await t.backend.mutation(internal.scout.workspaces.snapshot, {
          target: { kind: "site", site: "example.com" },
          userId: t.userId,
        });
        await t.backend.run(async (ctx) =>
          ctx.db.patch(t.userId, { email: "pending@example.test", isApproved: false }),
        );
        await expect(
          t.backend.mutation(internal.scout.workspaces.commit, {
            workspaceId: snapshot.workspaceId,
            userId: t.userId,
            expectedRevision: snapshot.revision,
            cwd: snapshot.cwd,
            entries: snapshot.entries,
          }),
        ).rejects.toThrow("Not authorized");
      });

      it("browses and edits shared files without creating a chat", async () => {
        const t = await setup();
        const userId = await t.backend.run((ctx) => insertTestAccount(ctx, { email: ADMIN_EMAIL }));
        const viewer = t.backend.withIdentity({ subject: `${userId}|session` });
        const result = await viewer.action(api.scout.workspaceTools.executeSiteCommand, {
          site: "Example.COM",
          command: "printf 'site notes' > guide.md",
        });
        expect(result).toMatchObject({ workspace: "example.com", exitCode: 0 });
        const file = await viewer.action(api.scout.workspaceTools.readFile, {
          target: { kind: "site", site: "example.com" },
          path: "/workspace/guide.md",
        });
        expect(file.text).toBe("site notes");
        expect(
          await t.backend.run((ctx) =>
            ctx.db
              .query("scoutChats")
              .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", userId))
              .first(),
          ),
        ).toBeNull();
        await expect(
          t.backend.action(api.scout.workspaceTools.executeSiteCommand, {
            site: "example.com",
            command: "rm guide.md",
          }),
        ).rejects.toThrow("Not authorized");
        await expect(
          viewer.action(api.scout.workspaceTools.executeSiteCommand, {
            site: "../example.com",
            command: "rm guide.md",
          }),
        ).rejects.toThrow("exact hostname");
        await t.backend.run((ctx) =>
          ctx.db.patch(userId, { email: "member@example.test", isApproved: true }),
        );
        await expect(
          viewer.action(api.scout.workspaceTools.executeSiteCommand, {
            site: "example.com",
            command: "rm guide.md",
          }),
        ).rejects.toThrow("Not authorized");
        await expect(
          viewer.action(api.scout.workspaceTools.readFile, {
            target: { kind: "site", site: "example.com" },
            path: "/workspace/guide.md",
          }),
        ).rejects.toThrow("Not authorized");
      });

      it("paginates sites alphabetically, excluding private workspaces and read-only misses", async () => {
        const t = await setup();
        await t.run("echo private > private.txt");
        await t.run("echo z > guide.md", "z.example");
        await t.run("echo a > guide.md", "a.example");
        expect(
          await t.owner.query(api.scout.workspaces.list, {
            target: { kind: "site", site: "missing.example" },
          }),
        ).toMatchObject({ exists: false, entries: [] });
        const first = await t.owner.query(api.scout.workspaces.listSites, {
          paginationOpts: { numItems: 1, cursor: null },
        });
        expect(first.page).toEqual(["a.example"]);
        const second = await t.owner.query(api.scout.workspaces.listSites, {
          paginationOpts: { numItems: 1, cursor: first.continueCursor },
        });
        expect(second.page).toEqual(["z.example"]);
        expect(second.isDone).toBe(true);
        await expect(
          t.backend.query(api.scout.workspaces.listSites, {
            paginationOpts: { numItems: 10, cursor: null },
          }),
        ).rejects.toThrow("Not authorized");
      });

      it("rejects stale site writes without deleting another task's update", async () => {
        const t = await setup();
        await t.run("echo first > guide.md", "example.com");
        const snapshot = await t.backend.mutation(internal.scout.workspaces.snapshot, {
          target: { kind: "site", site: "example.com" },
          userId: t.userId,
        });
        await t.runSession(t.otherSessionId, "echo second > guide.md", "example.com");
        const deletedBefore = [...deleted];
        await expect(
          t.backend.mutation(internal.scout.workspaces.commit, {
            workspaceId: snapshot.workspaceId,
            userId: t.userId,
            expectedRevision: snapshot.revision,
            cwd: snapshot.cwd,
            entries: [],
          }),
        ).rejects.toThrow("Another command changed this workspace");
        expect(deleted).toEqual(deletedBefore);
        expect(
          (
            await t.owner.action(api.scout.workspaceTools.readFile, {
              target: { kind: "site", site: "example.com" },
              path: "/workspace/guide.md",
            })
          ).text,
        ).toBe("second\n");
      });

      it.each([
        "",
        "../example.com",
        "https://example.com",
        "example.com/path",
        "example.com:443",
        "user@example.com",
        "a..example.com",
      ])("rejects invalid workspace names: %s", async (workspace) => {
        const t = await setup();
        await expect(t.run("echo should-not-run > x", workspace)).rejects.toThrow("exact hostname");
        expect(blobs.size).toBe(0);
      });
    });

    describe("workspace file registration", () => {
      it("rejects oversized research files before uploading or creating a workspace", async () => {
        const t = await setup();
        const target = { kind: "agent_session", sessionId: t.sessionId } satisfies WorkspaceTarget;
        await expect(
          t.owner.action((ctx) =>
            saveWorkspaceFile(ctx, {
              target,
              userId: t.userId,
              path: "/workspace/research/brief.md",
              text: "x".repeat(MAX_WORKSPACE_FILE_BYTES + 1),
            }),
          ),
        ).rejects.toThrow("File exceeds");
        expect(blobs.size).toBe(0);
        expect(await t.owner.query(api.scout.workspaces.list, { target })).toMatchObject({
          exists: false,
          entries: [],
        });
      });

      it("prevents a stale shell snapshot from removing a newly saved research file", async () => {
        const t = await setup();
        const target = { kind: "agent_session", sessionId: t.sessionId } satisfies WorkspaceTarget;
        await t.run("mkdir notes; cd notes");
        const snapshot = await t.backend.mutation(internal.scout.workspaces.snapshot, {
          target,
          userId: t.userId,
        });
        await t.owner.action((ctx) =>
          saveWorkspaceFile(ctx, {
            target,
            userId: t.userId,
            path: "/workspace/research/brief.md",
            text: "New research",
          }),
        );
        const before = await t.owner.query(api.scout.workspaces.list, { target });
        expect(before.cwd).toBe("/workspace/notes");
        await expect(
          t.backend.mutation(internal.scout.workspaces.commit, {
            workspaceId: snapshot.workspaceId,
            userId: t.userId,
            expectedRevision: snapshot.revision,
            cwd: snapshot.cwd,
            entries: snapshot.entries,
          }),
        ).rejects.toThrow("Another command changed this workspace");
        expect(await t.owner.query(api.scout.workspaces.list, { target })).toEqual(before);
        expect(await t.run("cat ../research/brief.md")).toMatchObject({ stdout: "New research" });
        expect(deleted).toEqual([]);
      });

      it("rejects occupied destinations of every kind and paths outside the workspace", async () => {
        const { backend, owner, userId, sessionId } = await setup();
        const snapshot = await backend.mutation(internal.scout.workspaces.snapshot, {
          target: { kind: "agent_session", sessionId },
          userId,
        });
        const file = {
          kind: "file",
          path: "/workspace/source.md",
          key: "test",
          size: 1,
          sha256: "test",
          mode: 0o644,
          mtime: 0,
        } satisfies WorkspaceEntry;
        for (const existing of [
          file,
          { kind: "directory", path: file.path, mode: 0o755, mtime: 0 },
          { kind: "symlink", path: file.path, target: "/workspace/elsewhere" },
        ] satisfies WorkspaceEntry[]) {
          const id = await backend.run((ctx) =>
            ctx.db.insert("scoutWorkspaceFiles", {
              workspaceId: snapshot.workspaceId,
              entry: existing,
            }),
          );
          await expect(
            backend.mutation(internal.scout.workspaces.addFile, {
              overwrite: false,
              workspaceId: snapshot.workspaceId,
              userId,
              entry: file,
            }),
          ).rejects.toThrow("already exists");
          await backend.run((ctx) => ctx.db.delete(id));
        }
        for (const path of [
          "/outside/source.md",
          "/workspace/../escape",
          "/workspace//source",
          "/workspace/sources/./source",
          "/workspace/sources\\source",
        ]) {
          await expect(
            backend.mutation(internal.scout.workspaces.addFile, {
              overwrite: false,
              workspaceId: snapshot.workspaceId,
              userId,
              entry: { ...file, path },
            }),
          ).rejects.toThrow("absolute path inside /workspace");
        }
        expect(
          (
            await owner.query(api.scout.workspaces.list, {
              target: { kind: "agent_session", sessionId },
            })
          ).revision,
        ).toBe(0);
      });

      it.each(["entries", "bytes"])(
        "checks current %s capacity transactionally and counts new parents",
        async (limit) => {
          const { backend, owner, userId, sessionId } = await setup();
          const snapshot = await backend.mutation(internal.scout.workspaces.snapshot, {
            target: { kind: "agent_session", sessionId },
            userId,
          });
          const file = {
            kind: "file",
            path: "/workspace/sources/example.com/source.md",
            key: "new",
            size: 1,
            sha256: "test",
            mode: 0o644,
            mtime: 0,
          } satisfies WorkspaceEntry;
          await backend.run(async (ctx) => {
            if (limit === "entries") {
              for (let i = 0; i < MAX_WORKSPACE_ENTRIES - 4; i++)
                await ctx.db.insert("scoutWorkspaceFiles", {
                  workspaceId: snapshot.workspaceId,
                  entry: { kind: "directory", path: `/workspace/dir-${i}`, mode: 0o755, mtime: 0 },
                });
            } else {
              for (let i = 0; i < MAX_WORKSPACE_BYTES / MAX_WORKSPACE_FILE_BYTES; i++)
                await ctx.db.insert("scoutWorkspaceFiles", {
                  workspaceId: snapshot.workspaceId,
                  entry: {
                    ...file,
                    path: `/workspace/file-${i}`,
                    size: MAX_WORKSPACE_FILE_BYTES - (i === 0 ? 1 : 0),
                    key: `old-${i}`,
                  },
                });
            }
          });
          await backend.mutation(internal.scout.workspaces.addFile, {
            overwrite: false,
            workspaceId: snapshot.workspaceId,
            userId,
            entry: file,
          });
          const before = await owner.query(api.scout.workspaces.list, {
            target: { kind: "agent_session", sessionId },
          });
          await expect(
            backend.mutation(internal.scout.workspaces.addFile, {
              overwrite: false,
              workspaceId: snapshot.workspaceId,
              userId,
              entry: { ...file, path: "/workspace/sources/example.com/another.md", key: "another" },
            }),
          ).rejects.toThrow("limit exceeded");
          expect(
            await owner.query(api.scout.workspaces.list, {
              target: { kind: "agent_session", sessionId },
            }),
          ).toEqual(before);
        },
      );
    });

    describe("concurrent workspace reads", () => {
      it("does not revise an unchanged workspace when bash reads run in parallel", async () => {
        const { owner, sessionId, userId, run } = await setup();
        await run("echo existing > saved.txt");
        const before = await owner.query(api.scout.workspaces.list, {
          target: { kind: "agent_session", sessionId },
        });
        const outputs = await Promise.all(
          ["cat saved.txt", "wc -l saved.txt"].map((command) =>
            owner.action(async (ctx) => {
              return createWorkspaceTools(
                ctx,
                { target: { kind: "agent_session", sessionId }, userId },
                async () => {},
              ).bash.execute(
                { command },
                { toolCallId: crypto.randomUUID(), messages: [], context: {} },
              );
            }),
          ),
        );
        expect(outputs.map((output) => bashResultSchema.parse(output).exitCode)).toEqual([0, 0]);
        expect(
          await owner.query(api.scout.workspaces.list, {
            target: { kind: "agent_session", sessionId },
          }),
        ).toEqual(before);
      });
    });

    it("removes an uploaded research file when the workspace rejects it at capacity", async () => {
      const t = await setup();
      const snapshot = await t.backend.mutation(internal.scout.workspaces.snapshot, {
        target: { kind: "agent_session", sessionId: t.sessionId },
        userId: t.userId,
      });
      await t.backend.run(async (ctx) => {
        for (let i = 0; i < MAX_WORKSPACE_ENTRIES; i++)
          await ctx.db.insert("scoutWorkspaceFiles", {
            workspaceId: snapshot.workspaceId,
            entry: { kind: "directory", path: "/workspace/dir-" + i, mode: 0o755, mtime: 0 },
          });
      });
      await expect(
        t.owner.action((ctx) =>
          saveWorkspaceFile(ctx, {
            target: { kind: "agent_session", sessionId: t.sessionId },
            userId: t.userId,
            path: "/workspace/research/brief.md",
            text: "A brief",
          }),
        ),
      ).rejects.toThrow("Workspace entry limit exceeded");
      expect(blobs.size).toBe(1);
      expect(deleted).toEqual([...blobs.keys()]);
    });

    it("replaces the latest site brief while retaining each session's private copy", async () => {
      const t = await setup();
      const path = "/workspace/research/brief.md";
      const saveSite = (text: string) =>
        t.owner.action((ctx) =>
          saveWorkspaceFile(ctx, {
            target: { kind: "site", site: "example.com" },
            userId: t.userId,
            path,
            text,
          }),
        );
      await saveSite("First research");
      await t.owner.action((ctx) =>
        saveWorkspaceFile(ctx, {
          target: { kind: "agent_session", sessionId: t.sessionId },
          userId: t.userId,
          path,
          text: "First research",
        }),
      );
      const oldSiteKey = [...blobs.keys()][0];
      await saveSite("Second research");
      const siteFile = await t.owner.action(api.scout.workspaceTools.readFile, {
        target: { kind: "site", site: "example.com" },
        path,
      });
      const sessionFile = await t.owner.action(api.scout.workspaceTools.readFile, {
        target: { kind: "agent_session", sessionId: t.sessionId },
        path,
      });
      expect(siteFile.text).toBe("Second research");
      expect(sessionFile.text).toBe("First research");
      expect(deleted).toEqual([oldSiteKey]);
    });
  },
);
