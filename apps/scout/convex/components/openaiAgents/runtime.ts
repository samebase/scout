import { v, type Infer } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { client } from "./client";
import { event, toolResult, readUsage } from "../../../shared/openaiAgents";
import { presentItem, session as providerSession, tools, turn } from "./provider";

async function latestRootTurn(openai: ReturnType<typeof client>, providerId: string) {
  // The turn list includes subagent turns, whose outcomes do not end the parent run.
  for await (const value of openai.beta.agents.sessions.turns.list(providerId, {
    order: "desc",
    limit: 50,
  })) {
    const parsed = turn.parse(value);
    if (parsed.subagent_id === null) return parsed;
  }
  return null;
}

async function requireSession(ctx: ActionCtx, sessionKey: string) {
  const session = await ctx.runQuery(api.state.get, { sessionKey });
  if (!session?.providerId) throw new Error("OpenAI session is not available");
  return { ...session, providerId: session.providerId };
}

async function cancelProvider(providerId: string) {
  const openai = client();
  const remote = providerSession.parse(await openai.beta.agents.sessions.retrieve(providerId));
  if (remote.status === "in_progress" || remote.status === "requires_action") {
    await openai.beta.agents.sessions.events.create(providerId, {
      events: [{ type: "agent.session.input.cancel" }],
    });
  }
}

async function afterInput(ctx: ActionCtx, session: Doc<"sessions"> & { providerId: string }) {
  const current = await ctx.runQuery(api.state.read, { sessionId: session._id });
  if (current.stopped) await cancelProvider(session.providerId);
  await ctx.runMutation(api.state.refresh, { sessionKey: session.sessionKey });
}

export const create = action({
  args: {
    sessionKey: v.string(),
    runKey: v.string(),
    onEvent: v.string(),
    model: v.string(),
    instructions: v.string(),
    toolsJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const openai = client();
    const definitions = tools.parse(JSON.parse(args.toolsJson));
    const sessionId = await ctx.runMutation(api.state.register, {
      sessionKey: args.sessionKey,
      runKey: args.runKey,
      onEvent: args.onEvent,
    });
    // Attach the provider ID before submitting input so actionable webhooks can be routed.
    const created = providerSession.parse(
      await openai.beta.agents.sessions.create({
        agent: {
          model: args.model,
          instructions: args.instructions,
          tools: definitions,
          reasoning: { effort: "max", summary: "auto" },
        },
        environment: { type: "none" },
        stream: false,
        metadata: { convexSessionKey: args.sessionKey },
      }),
    );
    await ctx.runMutation(internal.state.attach, { sessionId, providerId: created.id });
    const session = await ctx.runQuery(api.state.read, { sessionId });
    if (session.stopped) await cancelProvider(created.id);
    return null;
  },
});

export const send = action({
  args: { sessionKey: v.string(), runKey: v.string(), message: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await requireSession(ctx, args.sessionKey);
    const openai = client();
    const previousTurn = await latestRootTurn(openai, session.providerId);
    await ctx.runMutation(api.state.prepare, {
      sessionKey: args.sessionKey,
      runKey: args.runKey,
      previousTurnId: previousTurn?.id ?? null,
      expectedGeneration: session.generation,
    });
    await openai.beta.agents.sessions.events.create(session.providerId, {
      "Idempotency-Key": `${args.sessionKey}:${args.runKey}`,
      events: [
        {
          type: "agent.session.input.message",
          input: [{ role: "user", content: [{ type: "input_text", text: args.message }] }],
        },
      ],
    });
    await afterInput(ctx, session);
    return null;
  },
});

export const submitToolResult = action({
  args: {
    sessionKey: v.string(),
    runKey: v.string(),
    callId: v.string(),
    turnId: v.string(),
    result: toolResult,
    resume: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await requireSession(ctx, args.sessionKey);
    if (session.stopped) return null;
    if (args.resume)
      await ctx.runMutation(api.state.prepare, {
        sessionKey: args.sessionKey,
        runKey: args.runKey,
        previousTurnId: session.previousTurnId,
        expectedGeneration: session.generation,
      });
    else if (session.runKey !== args.runKey) return null;
    if (await ctx.runQuery(api.state.submitted, { sessionId: session._id, callId: args.callId }))
      return null;
    await client().beta.agents.sessions.events.create(session.providerId, {
      "Idempotency-Key": `${session.providerId}:${args.callId}`,
      events: [
        {
          type: "agent.session.input.tool_result",
          call_id: args.callId,
          turn_id: args.turnId,
          ...(args.result.kind === "success"
            ? { success: true, output: args.result.output }
            : { success: false, error: args.result.error }),
        },
      ],
    });
    await ctx.runMutation(internal.state.recordResult, {
      sessionId: session._id,
      callId: args.callId,
    });
    await afterInput(ctx, session);
    return null;
  },
});

export const cancel = action({
  args: { sessionKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const session = await ctx.runMutation(api.state.stop, args);
    if (session?.providerId) {
      await cancelProvider(session.providerId);
      await ctx.runMutation(api.state.refresh, args);
    }
    return null;
  },
});

export const sync = internalAction({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, { sessionId }): Promise<null> => {
    const session = await ctx.runQuery(api.state.read, { sessionId });
    const publish = async (update: Infer<typeof event>) =>
      await ctx.runMutation(internal.state.publish, {
        sessionId,
        generation: session.generation,
        event: update,
      });
    let error: string | null = null;
    try {
      if (!session.providerId) return null;
      const openai = client();
      const remote = providerSession.parse(
        await openai.beta.agents.sessions.retrieve(session.providerId),
      );
      const items = openai.beta.agents.sessions.items.list(session.providerId, {
        order: "asc",
        limit: 50,
        ...(session.itemCursor === null ? {} : { after: session.itemCursor }),
      });
      let sequence = session.nextSequence;
      let itemCursor = session.itemCursor;
      let nextSequence = sequence;
      let contiguous = true;
      for await (const value of items) {
        const item = presentItem(value);
        if (item) await publish({ kind: "item", item, sequence });
        else contiguous = false;
        sequence++;
        if (contiguous && item) {
          itemCursor = item.providerItemId;
          nextSequence = sequence;
        }
      }
      await ctx.runMutation(internal.state.checkpoint, {
        sessionId,
        generation: session.generation,
        itemCursor,
        nextSequence,
      });
      const usage = readUsage(remote.usage);
      if (remote.status === "failed") {
        await publish({
          kind: "state",
          state: { kind: "failed", error: remote.error ?? "OpenAI session failed" },
          usage,
        });
        return null;
      }
      if (remote.status === "idle") {
        const latest = await latestRootTurn(openai, session.providerId);
        if (latest && latest.id !== session.previousTurnId) {
          switch (latest.status) {
            case "completed":
              await publish({ kind: "state", state: { kind: "idle" }, usage });
              return null;
            case "cancelled":
              await publish({ kind: "state", state: { kind: "stopped" }, usage });
              return null;
            case "failed":
              await publish({
                kind: "state",
                state: { kind: "failed", error: JSON.stringify(latest.error) },
                usage,
              });
              return null;
            case "queued":
            case "waiting":
            case "in_progress":
              break;
            default: {
              const unhandled: never = latest.status;
              throw new Error(`Unknown turn status: ${JSON.stringify(unhandled)}`);
            }
          }
        }
      }
      await publish({ kind: "state", state: { kind: "running" }, usage });
      if (session.stopped) return null;
      // Scout's browser tools execute sequentially; a result submission schedules the next refresh.
      for (const call of remote.required_actions) {
        if (call.type !== "function_call")
          throw new Error("OpenAI requested an unsupported environment connection");
        if (call.turn_id === session.previousTurnId) continue;
        if (await ctx.runQuery(api.state.submitted, { sessionId, callId: call.call_id })) continue;
        await publish({
          kind: "tool",
          call: {
            callId: call.call_id,
            turnId: call.turn_id,
            name: call.name,
            argumentsJson: JSON.stringify(call.arguments),
          },
        });
        break;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      await publish({ kind: "state", state: { kind: "failed", error }, usage: null });
      throw cause;
    } finally {
      await ctx.runMutation(internal.state.finish, {
        sessionId,
        generation: session.generation,
        revision: session.revision,
        error,
      });
    }
    return null;
  },
});
