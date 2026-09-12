# Agents API experiment

Open `/agents` with Lab access. Choose a Scout and enter a task. This page uses
OpenAI's managed Agents API with `gpt-5.6-luna` at maximum reasoning effort.

The existing Play, Review, and Lab runtimes remain separate. This experiment reuses
Scout identity, inbox access, encrypted account credentials, and Firecrawl browser
tools. A Scout is reserved across both runtimes while its experiment is active.

## Configuration

Set `OPENAI_API_KEY` on the same Convex deployment used by the frontend. The tested
restricted key permissions are Agents read/write, Responses read/write, and List
models read. Existing Firecrawl, AgentMail, and credential-encryption configuration
must also be present.

Run `pnpm run dev` from the primary checkout for port 5173 and its development
deployment. API usage is billed to the configured OpenAI project; Scout credits do
not apply to this experiment.

## Execution

- OpenAI owns the agent loop, model context, and provider history.
- Sessions use `environment.type: "none"`. Browser and email tools run through
  Convex, so this experiment does not provision an additional shell sandbox.
- Convex Workflow submits work and services requested functions. It does not run
  another LLM loop through `@convex-dev/agent`.
- `sessions.ts` owns access checks, session state, and durable function-call claims.
  A completed tool result is reused if OpenAI requests the same call again.
- `runtime.ts` polls provider state and saves history by provider item ID. Saved
  items can lag live execution; the browser view shows the current remote page.
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
- Refresh retrieves late provider history and usage for an ended session without
  restarting it. A refresh preserves any failure or stopped state.

Errors remain visible. Interrupted side effects are not automatically replayed.
There is no built-in shell or integration with shared site workspaces or Scout
credits. An OpenAI-hosted environment can be added when a task needs files or
command execution; see the [architecture guide](https://developers.openai.com/api/docs/guides/agents-api/architecture).

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

The final check passed formatting, lint, all TypeScript projects, and 768 tests,
with three existing tests skipped. The frontend build also passed.
