import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import {
  browserBridgeRequestSchema,
  manualToolResultSchema,
  parseLoopbackRunnerUrl,
  preparedScoutRunSchema,
  runnerSecretFromHash,
  serializedRunnerToolDefinitionSchema,
  runnerToolDefinitionSchema,
  type BrowserBridgeResponse,
} from "../lib/scoutRunnerProtocol";
import { useEffect, useRef, useState } from "react";

type RunnerScout = Pick<FunctionReturnType<typeof api.scout.scouts.list>[number], "_id" | "slug">;

type BridgeState =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "failed"; message: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown runner bridge error";
}

async function responseJson(response: Response) {
  const value: unknown = await response.json();
  return value;
}

function parseRunnerToolDefinition(
  tool: FunctionReturnType<typeof api.scout.manual.describeTools>["tools"][number],
) {
  const inputSchema: unknown = JSON.parse(tool.inputSchemaJson);
  return runnerToolDefinitionSchema.parse({
    name: tool.name,
    description: tool.description,
    inputSchema,
  });
}

export function ScoutRunnerBridge({
  runnerUrl,
  scouts,
  onPrepared,
}: {
  runnerUrl: string;
  scouts: readonly RunnerScout[];
  onPrepared: (prepared: { threadId: string; scoutId: RunnerScout["_id"] }) => void;
}) {
  const convex = useConvex();
  const [state, setState] = useState<BridgeState>({ kind: "connecting" });
  const scoutsRef = useRef(scouts);
  const onPreparedRef = useRef(onPrepared);
  const pairingRef = useRef<{
    runnerUrl: string;
    secret: string | null;
    clientId: string;
  } | null>(null);
  if (pairingRef.current?.runnerUrl !== runnerUrl) {
    pairingRef.current = {
      runnerUrl,
      secret: runnerSecretFromHash(window.location.hash),
      clientId: window.crypto.randomUUID(),
    };
  }
  scoutsRef.current = scouts;
  onPreparedRef.current = onPrepared;

  useEffect(() => {
    const bridge = parseLoopbackRunnerUrl(runnerUrl);
    const pairing = pairingRef.current;
    const secret = pairing?.runnerUrl === runnerUrl ? pairing.secret : null;
    if (!bridge || !pairing || !secret) {
      setState({ kind: "failed", message: "This local runner link is invalid or has expired." });
      return;
    }

    const abortController = new AbortController();
    const endpoint = (path: string) => new URL(path, bridge).toString();
    const headers = {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    };
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

    const sendResponse = async (response: BrowserBridgeResponse) => {
      const sent = await fetch(endpoint("/api/respond"), {
        method: "POST",
        headers,
        body: JSON.stringify(response),
        signal: abortController.signal,
      });
      if (!sent.ok) throw new Error(`Runner rejected a response with status ${sent.status}`);
    };

    const handleNextRequest = async () => {
      const next = await fetch(endpoint("/api/next"), {
        headers: { authorization: headers.authorization },
        cache: "no-store",
        signal: abortController.signal,
      });
      if (next.status === 204) return;
      if (!next.ok) throw new Error(`Runner polling failed with status ${next.status}`);
      const parsed = browserBridgeRequestSchema.safeParse(await responseJson(next));
      if (!parsed.success) throw new Error("Runner sent an invalid bridge request");
      const request = parsed.data;
      try {
        if (request.kind === "prepare") {
          const scout = scoutsRef.current.find((candidate) => candidate.slug === request.scoutSlug);
          if (!scout) throw new Error(`Active Scout /${request.scoutSlug} was not found`);
          const created = await convex.mutation(api.scout.chats.createThread, {
            scoutId: scout._id,
          });
          const turn = await convex.action(api.scout.manual.beginTurn, {
            threadId: created.threadId,
            prompt: request.prompt,
          });
          const { context, described } = await (async () => {
            try {
              const [context, described] = await Promise.all([
                convex.query(api.scout.chats.getThreadAgentContext, {
                  threadId: created.threadId,
                }),
                convex.action(api.scout.manual.describeTools, { threadId: created.threadId }),
              ]);
              return { context, described };
            } catch (error) {
              await convex
                .action(api.scout.manual.finishTurn, {
                  threadId: created.threadId,
                  promptMessageId: turn.promptMessageId,
                  outcome: { kind: "failed", error: errorMessage(error) },
                })
                .catch(() => undefined);
              throw error;
            }
          })();
          const tools = serializedRunnerToolDefinitionSchema
            .array()
            .parse(described.tools)
            .map(parseRunnerToolDefinition);
          const chatUrl = new URL("/chats", window.location.origin);
          chatUrl.searchParams.set("thread", created.threadId);
          const prepared = preparedScoutRunSchema.parse({
            threadId: created.threadId,
            promptMessageId: turn.promptMessageId,
            chatUrl: chatUrl.toString(),
            instructions: context.instructions,
            tools,
          });
          onPreparedRef.current({ threadId: created.threadId, scoutId: scout._id });
          await sendResponse({ kind: "success", requestId: request.requestId, value: prepared });
          return;
        }

        if (request.kind === "finish") {
          await convex.action(api.scout.manual.finishTurn, {
            threadId: request.threadId,
            promptMessageId: request.promptMessageId,
            outcome: request.outcome,
          });
          await sendResponse({ kind: "success", requestId: request.requestId, value: null });
          return;
        }

        const result = manualToolResultSchema.parse(
          await convex.action(api.scout.manual.executeTool, {
            threadId: request.threadId,
            promptMessageId: request.promptMessageId,
            toolName: request.toolName,
            input: JSON.stringify(request.input),
          }),
        );
        await sendResponse({ kind: "success", requestId: request.requestId, value: result });
      } catch (error) {
        await sendResponse({
          kind: "error",
          requestId: request.requestId,
          error: errorMessage(error),
        });
      }
    };

    const run = async () => {
      const registered = await fetch(endpoint("/api/register"), {
        method: "POST",
        headers,
        body: JSON.stringify({ clientId: pairing.clientId }),
        signal: abortController.signal,
      });
      if (!registered.ok) throw new Error(`Runner pairing failed with status ${registered.status}`);
      setState({ kind: "connected" });
      while (!abortController.signal.aborted) await handleNextRequest();
    };

    void run().catch((error: unknown) => {
      if (!abortController.signal.aborted) {
        setState({ kind: "failed", message: errorMessage(error) });
      }
    });
    return () => abortController.abort();
  }, [convex, runnerUrl]);

  return (
    <div
      className={
        state.kind === "failed"
          ? "border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          : "border-b bg-muted/40 px-4 py-2 text-sm"
      }
      role="status"
    >
      {state.kind === "connecting"
        ? "Connecting local Codex runner..."
        : state.kind === "connected"
          ? "Local Codex runner connected. Keep this tab open."
          : state.message}
    </div>
  );
}
