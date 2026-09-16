# Local OpenAI Agents component

This component implements hosted Agents API sessions with `environment.type: "none"`.
It is installed by the app's `convex.config.ts` with a webhook HTTP prefix and bindings
for `OPENAI_API_KEY` and `OPENAI_WEBHOOK_SECRET`.

The app calls `runtime.create`, `runtime.send`, `runtime.submitToolResult`,
`runtime.cancel`, and `state.refresh`. Creation accepts an app session key, a run key,
the agent configuration, and a mutation handle created with `createFunctionHandle`.
The callback contract is in `shared/openaiAgents.ts`. Component exports remain
internal to the app; user authorization belongs in the app's wrappers.

The component stores delivery receipts, provider session IDs, history cursors, and
acknowledged tool-result IDs. The application callback stores the transcript where
the app's existing subscriptions read it, and schedules application-specific tools.
Callbacks must ignore old run keys and claim tool calls before executing side effects.
An `idle` notification comes from a completed turn; failed and cancelled turns have
their own outcomes even when OpenAI reports the session itself as idle.

The HTTP handler verifies the raw signed request, commits a receipt and a scheduled
refresh, and returns. Events for another app's session are acknowledged without work.
No scheduled polling, persistent stream, external relay, or automatic retry framework
is used. Individual OpenAI HTTP requests retain the app's limit of three retries for
transient errors. Inspect `sessions.syncError` and the scheduled action logs after a failure;
fix the cause and explicitly refresh or start another session.

OpenAI may not emit a webhook for each completed message. The transcript updates when
a session lifecycle event arrives, after input/tool submission, or on manual refresh.
Model and application tool charges still apply; the avoided charge is the Convex
action time previously spent waiting for streamed output.
