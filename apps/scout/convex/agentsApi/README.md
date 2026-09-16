# Agents API experiment

Open `/agents` with Lab access. Choose a Scout and enter a task. This page uses
OpenAI's managed Agents API with `gpt-5.6-luna` at maximum reasoning effort.

Review uses this runtime, and its sessions also appear in `/agents`. Admins can
inspect all sessions, including transcripts, cost, live view, and replay. Only the
owner can send, stop, resume, or control the live browser. The list loads older
sessions through pagination. Play still uses the Convex runtime and `/chats` inspector.

This experiment reuses
Scout identity, inbox access, encrypted account credentials, and Firecrawl browser
tools. A Scout is reserved across both runtimes while its experiment is active.

## Configuration

Set `OPENAI_API_KEY` on the same Convex deployment used by the frontend. The tested
restricted key permissions are Agents read/write, Responses read/write, and List
models read. Existing Firecrawl, AgentMail, and credential-encryption configuration
must also be present.

Create an endpoint in the OpenAI project's webhook settings pointing to
`https://<deployment>.convex.site/openai-agents/webhook`, using that deployment's
HTTP actions URL. Subscribe to `agent.session.created`, `agent.session.action_required`,
`agent.session.in_progress`, `agent.session.idle`, and `agent.session.failed`. Save
the endpoint's signing secret as `OPENAI_WEBHOOK_SECRET` on that Convex deployment.
Both OpenAI variables are bound to the local component in `convex.config.ts`.
New sessions fail visibly if either variable is missing.

Run `pnpm run dev` from the primary checkout for port 5173 and its development
deployment. API usage is billed to the configured OpenAI project; Scout credits do
not apply to this experiment.

## Execution

- OpenAI owns the agent loop, model context, and provider history.
- `instructions.ts` contains the experiment's guidance for accounts, email, browser
  handoffs, research, reviews, and task completion. `runtime.ts` combines it with the
  Scout's identity and account inventory when creating the OpenAI session. Prompt edits
  apply to new sessions; follow-ups keep their session's original instructions.
- Sessions use `environment.type: "none"`. Browser, email, and `bash` tools run
  through Convex without provisioning an OpenAI-hosted environment.
- `bash` reuses Scout's just-bash workspace. Omit `workspace` for private files owned
  by this agent session, or set it to a hostname for shared site files. Both use the
  existing Convex file index, R2 storage, and workspace limits. Bash does not attach
  to the Firecrawl browser. New sessions receive the tool; existing OpenAI sessions
  keep the tool definitions they were created with.
- The Agents Workspace view reuses the existing file browser for inspection and
  downloads. Admins can inspect member session files, but cannot run commands in
  another owner's session. Shared files remain available in Sites.
- Convex Workflow runs the request or resume check, gathers site research for new
  reviews, submits the command, then exits.
  The local `components/openaiAgents` component owns provider requests, signed webhook
  handling, delivery receipts, session cursors, and submitted tool-result IDs.
  Provider HTTP requests use the default Convex runtime. Node actions only run Scout's
  command setup and tools; no action waits on an OpenAI event stream.
- `sessions.ts` owns access checks, session state, and durable function-call claims.
  A completed tool result is reused if OpenAI requests the same call again.
- Webhooks schedule short refresh actions. One refresh runs per session at a time;
  events received during it schedule another pass. Duplicate deliveries do not start
  duplicate work, and acknowledged tool results are not resubmitted while the provider
  still shows an older required-action snapshot. Refresh failures remain inspectable.
- The component calls `sessions.onEvent` with completed output, state changes, or a
  tool request. Scout keeps its existing authorized transcript queries and browser/tool
  records. Messages appear at lifecycle updates rather than token by token. Every
  callback carries the command's run ID; late results cannot overwrite a newer run.
- Stop schedules cancellation and browser cleanup. If an input command is still being
  submitted, the Scout stays reserved until it finishes so a new command cannot race
  the old HTTP request. The stopped session retains its completed transcript and usage.
- Each browser operation reconnects to the saved Firecrawl browser, then disconnects
  its local Playwright transport. Completing or stopping a turn closes the remote
  browser and saves its profile.
- A browser handoff retains the browser and Scout reservation until Resume or Stop.
  Browser control links are visible only to the session owner with Lab access.
- Browser sessions and operations are retained independently of the active connection.
  The Agents page uses the shared sidebar layout and Lab replay player, including
  tab selection, click overlays, seeking, and MP4 export. Earlier experimental runs
  did not retain browser recording IDs and cannot show a replay here.
- Cost shows estimated OpenAI model/search charges and provider-reported Firecrawl
  credits. Cached input is priced separately; cumulative usage snapshots replace
  previous snapshots. Firecrawl dollars depend on the subscription's credit price.
  Model estimates use standard rates, excluding cache-write premiums and possible
  long-context charges, because session totals do not report per-request context sizes.
- Refresh schedules a provider update without sending a message. The owner can also
  refresh an active session after a missed webhook; other admins can refresh ended
  sessions. Refresh preserves failure and stopped states. No polling fallback or
  automatic replay of interrupted side effects is installed.

Errors remain visible. Interrupted side effects are not automatically replayed.
Scout credits are not integrated with this runtime. Workspace access does not yet
add the proposed intake or automatic research stages.

## Live verification, September 12, 2026

The ordinary prompt was: “Try Samebase by creating a disposable app. Check that
the deployed app actually works.” Scout reused its GitHub login, recorded the
Samebase account, and created `conrad-scout/samebase-codex-smoke-20260911`.

The first attempt encountered a Firecrawl connection timeout. After fixing local
connection disposal and using the existing reconnection helper, the follow-up
“Continue checking the app you created.” completed. Scout opened the public app,
continued as a guest, added a todo, reloaded, and observed that the todo persisted.
The repository and deployment were retained for inspection.

Stop cancelled a live OpenAI turn and released its browser. An inbox read reached
the selected Scout's real inbox. One handoff-resume attempt was accepted by OpenAI
but remained in progress without further requested actions until manually stopped.
Two fresh control sessions also encountered OpenAI's `409 the hosted environment
failed to provision` error. A separate function-call round trip completed with
`environment.type: "none"`, which is now the default. The original trial failures
remain in the session list.

With the final configuration, a fresh UI session opened example.com, paused for
handoff, resumed through the Resume button, read the Scout's inbox, reported the
latest subject, and closed its browser. A separate fresh review opened the deployed
app with the saved guest identity, observed the earlier todo, and checked About/Home
navigation without modifying data.

The sidebar/replay trial opened example.com, paused for handoff, and resumed through
the UI. A follow-up opened IANA's reserved-domain page in a second browser. The first
recording remained selectable while the second browser was live, and both recordings
remained after completion. The live control URL opened successfully; replay seeking
displayed the recorded page. Cost retained cached-input usage and Firecrawl credits.
The shorter recording generated an MP4 download link in desktop Chrome. The browser
automation did not confirm the subsequent download event.

A final ordinary review added and completed a disposable todo, reloaded, verified
the saved completion state, and closed its browser. A checkbox assertion failed after
changing the control; Scout inspected the actual state and continued successfully.
The replay retained the clicks and marked that uncertain operation. The earlier
unhandled dialog rejection during reload did not recur after handling the competing
CDP clients' already-dismissed dialog response.

The follow-up exposed a provider timing edge: input can be acknowledged while the
previous completed turn or tool request is still returned. Polling now waits for the
new turn instead of treating that previous turn as the follow-up's result.

Live-output verification used an ordinary Score Four review. Assistant messages,
reasoning summaries, and tool activity appeared while the browser was active.
Stopping retained the transcript, cost, and replay without pressing Refresh.
The follow-up reopened the browser, checked local play and the multiplayer waiting
room, exercised turn-taking and wins, and closed the browser with its progress
messages visible throughout.

The live iframe displayed correctly in Chrome. Codex's in-app browser showed a
blank cross-origin iframe for both Firecrawl and an example.com control, while
same-origin frames and the standalone viewer worked. No speculative embed changes
were retained; Open remains available for that browser.

After bringing over the relevant account, email, research, and completion guidance,
a fresh session's instructions retrieved from OpenAI matched the local prompt.
Conrad signed out of GitHub, signed back in with the managed password, recorded the
account, and searched and read security email threads without requesting a handoff.
GitHub did not require an email verification code in this trial, so it does not yet
verify the new code-entry guidance against a live challenge.
