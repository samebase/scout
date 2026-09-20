# Shared tasks and execution engines

Open `/lab` with admin access. Choose a Scout, a model, and a task.
Luna runs through OpenAI Agents API or Convex Agent with maximum reasoning effort.
Qwen 3.7 Flash and DeepSeek V4 Flash run through Convex Agent and Convex AI Gateway.
The model and engine are fixed for the lifetime of a task.

Member Review and Play offer the same model choices and remember the selected Scout,
engine, and Convex model. New accounts default to Luna through Agents API.
Their tasks also appear in `/lab`. Admins can
inspect all sessions, including transcripts, cost, live view, and replay. Only the
owner can send, stop, resume, or control the live browser. The list loads older
sessions through pagination.

Both execution engines share
Scout identity, inbox access, encrypted account credentials, and Firecrawl browser
tools, request checks, site research, screenshots, walkthroughs, access rules, and
cost presentation. A Scout remains reserved until its task and resource cleanup finish.

`lifecycle.ts` owns the common task pipeline. `runtime.ts` dispatches execution to
`agentsApi.ts` or `convexAgent.ts`; `execution.ts` owns common prompts, tool-call
claims and results, and browser cleanup. A completed tool result is reused, while an
interrupted call with an unknown outcome fails visibly instead of repeating its side effects.
Provider-specific execution details remain in their driver and its supporting modules.

The Convex driver keeps its native component transcript and summarizes older model
context while removing superseded browser snapshots from model input. Stored evidence
is retained. Agents API owns its model context and compaction; Scout does not rewrite
that provider history. These are deliberately different execution capabilities.
Agents API also retains native web search. Convex Agent has browser navigation and
the same preliminary site research, but no native web-search tool.

Existing `agentsApi*` database table names are retained to keep saved tasks, recordings,
and external references intact. They now store the shared task data for both engines.
Older Lab conversations remain read-only history; the old execution pipeline is retired.

## Configuration

Set `OPENAI_API_KEY` on the same Convex deployment used by the frontend. The tested
restricted key permissions are Agents read/write, Responses read/write, and List
models read. Existing Firecrawl, AgentMail, and credential-encryption configuration
must also be present.

Run `pnpm run dev` from the primary checkout for port 5173 and its development
deployment. API usage is billed to the configured OpenAI project and consumes Scout
credits when credit billing is enabled.

## Execution

- For Agents API tasks, OpenAI owns the agent loop, model context, and provider history.
  Convex Agent tasks use the component transcript and Gateway model calls.
- `instructions.ts` contains shared guidance for accounts, email, browser
  handoffs, research, reviews, and task completion. `execution.ts` combines it with the
  Scout's identity and account inventory. Agents API fixes these instructions when
  creating its provider session; Convex Agent builds them before each model step.
- Agents API sessions use `environment.type: "none"`. Browser, email, and `bash` tools run
  through Convex without provisioning an OpenAI-hosted environment.
- `bash` reuses Scout's just-bash workspace. Omit `workspace` for private files owned
  by this agent session, or set it to a hostname for shared site files. Both use the
  existing Convex file index, R2 storage, and workspace limits. Bash does not attach
  to the Firecrawl browser. New sessions receive the tool; existing OpenAI sessions
  keep the tool definitions they were created with.
- The Agents Workspace view reuses the existing file browser for inspection and
  downloads. Admins can inspect member session files, but cannot run commands in
  another owner's session. Shared files remain available in Sites.
- Convex Workflow runs checks and research before dispatching the selected driver.
  Agents API services provider-requested functions; Convex Agent generates one model
  step at a time and dispatches calls through the same tool executor.
- `sessions.ts` owns access checks, session state, and durable function-call claims.
  A completed tool result is reused if OpenAI requests the same call again.
- `agentsApi.ts` streams assistant text, reasoning summaries, and tool items into
  Convex by provider item ID. It subscribes before submitting input or tool results.
  Bounded stream slices restore saved items on reconnect. Stop retains streamed
  output, cancels the run, and releases the browser before refreshing history and usage.
- Each browser operation reconnects to the saved Firecrawl browser, then disconnects
  its local Playwright transport. Completing or stopping a turn closes the remote
  browser and saves its profile.
- A browser handoff retains the browser and Scout reservation until Resume or Stop.
  Browser control links are visible only to the session owner with Lab access.
- Browser sessions and operations are retained independently of the active connection.
  The Lab page uses the shared sidebar layout and replay player, including
  tab selection, click overlays, seeking, and MP4 export. Earlier experimental runs
  did not retain browser recording IDs and cannot show a replay here.
- Cost shows estimated OpenAI model/search charges, reported Gateway model charges when
  available, and provider-reported Firecrawl
  credits. Cached input is priced separately; cumulative usage snapshots replace
  previous snapshots. Firecrawl dollars depend on the subscription's credit price.
  Model estimates use standard rates, excluding cache-write premiums and possible
  long-context charges, because session totals do not report per-request context sizes.
- Refresh retrieves late provider history and usage for an ended session without
  restarting it. A refresh preserves any failure or stopped state.

When an Agents API task becomes inactive, Convex schedules a usage-only read immediately,
then again after 30 seconds and another two minutes. These bounded checks replace the saved
cumulative snapshot, including older partial totals, without reserving the Scout or changing
the transcript. Writes from an older workflow are discarded. Missing usage stays pending;
after the last check, missing usage records a failed scheduled action. Admins can use Refresh
in Lab to fetch it again manually. Missing token counts display as “Usage pending”; an
unknown model rate still displays as “Unpriced”.

Errors remain visible. Interrupted side effects are not automatically replayed.
With credits enabled, new work requires a positive wallet balance and no account hold.
Actual usage is charged when reported, even if that makes the balance negative. Missing
usage does not block follow-ups, stop, or cleanup.

Each start/send captures whether model work is paid; handoff resume retains that choice.
Agents API billing uses the exact root turn ID and search items with that turn ID. Final
refresh jobs capture the billing identity independently of the session's current turn, so
late paid usage still bills after a new paid or free follow-up starts. Cumulative session
snapshots are display data. Convex Agent bills reported Gateway cost by prompt/step, with
separate keys for summaries. Repeated reports of the same cumulative cost do not charge
again. Missing cached-token details or Gateway cost never become an uncached estimate.

Use Refresh in Lab to check the current turn again. If an older turn exhausted its
three checks after a follow-up started, inspect the failed refresh job and rerun its
captured arguments once provider usage is available. There is no reservation, settlement
queue, or automatic reconciliation. Old sessions without a billing flag remain free.

Walkthrough follow-ups use one Luna reporting call with the previous walkthrough, user requests,
and the browser agent’s new draft. The call has no browser tools. Lab shows its request, response,
model, duration, usage, cost, and failure alongside the other task calls. Valid results replace
the current walkthrough atomically; a failed or stopped update preserves the previous report.
The accepted summary and checks are returned to the browser agent. Reporting cost is charged
once per tool call and included in the task total. Initial walkthroughs do not need this extra call.

## Restored-model verification, September 19, 2026

On an isolated development deployment, Qwen 3.7 Flash and DeepSeek V4 Flash each
streamed a call using the shared account-recording schema, recalled its synthetic
result in a follow-up, and returned per-step Gateway cost. The callback used a fixture;
this verified provider/tool compatibility without creating an external account.

## Shared-engine verification, September 18, 2026

On the personal development deployment, the same admin task opened example.com,
verified its heading, saved a screenshot and walkthrough, and closed the browser
using each engine. Both runs retained their transcript and replay records in the
shared Lab UI. A Convex follow-up recalled the heading without reopening the browser.
The Agents API run encountered a provider-side `no active turn` error on its first
browser request; the error remained visible and the agent's next request succeeded.

## Historical Agents API verification, September 12, 2026

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
