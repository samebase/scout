# Convex-native Scout runs

## Decision

Scout will run its agent inside the existing Convex backend. A run uses:

- `@convex-dev/agent` for the model thread and tool calls.
- `@convex-dev/workflow` for durable steps, waits, retries, and concurrency limits.
- Convex AI Gateway with `openai/gpt-5.6-luna` as the first production model.
- The existing Firecrawl and AgentMail clients as agent tools.

Cloudflare continues to host the web app and support its email flow. It does not run an agent
process. Firecrawl owns the remote browser session.

This keeps one application backend. Each checkout still follows the existing `pnpm run dev`
workflow, and production does not need a container image, runner URL, callback secret, or another
set of logs.

## First runnable version

The first version supports one reusable Scout identity and one active run for that identity. The
identity owns an AgentMail inbox and a persistent Firecrawl profile. Runs create temporary browser
sessions from that profile instead of creating a new inbox or browser identity each time.

An admin starts a run with a target URL and a mission. Convex then:

1. Creates the `scoutRuns` record, the Agent thread, and the Workflow.
2. Lets Luna perform a bounded group of tool calls.
3. Saves model context in the Agent thread and public-safe progress in `scoutRunEvents`.
4. Starts another bounded group until the mission completes, fails, reaches a budget, or needs a
   person.
5. Stops the Firecrawl session and records the result and provider usage.

Firecrawl code interactions are the primary browser tool. The model receives structured actions
such as open, snapshot, click, fill, press, get, and wait. Scout turns each validated action into one
shell-quoted `agent-browser` invocation and inspects the result before choosing the next action. The
model never receives a shell/code tool, Firecrawl session identifier, or provider URL. Browser
profile selection belongs to trusted run configuration rather than the model.

Firecrawl prompt interactions remain available for isolated experiments, but they are not part of
the default production loop. The Tally benchmarks made them slower, more expensive, and harder to
debug than letting the Scout model control code interactions directly. Production AgentMail tools
will bind an inbox to a run and put a verification link or code into the browser without returning
the secret to the model or the public timeline.

The private Lab deliberately precedes that production boundary. An app-owned mapping binds each new
Lab thread to one registered Scout, and that binding cannot change after the thread is created. The
trusted runtime selects the Scout's Firecrawl profile and closes the read-only AgentMail tools over
that Scout's inbox; neither provider identity is a model-selectable argument. Older experiments
remain visible as unassigned history, but the admin UI will not continue them under a newly selected
identity.

## Harness evidence

A read-only Tally login inspection compared the raw hosted MCP catalogs with the guarded browser
tools on the same development deployment:

| Model          | Harness               | Tool calls | Input tokens |   Time | Firecrawl credits | Result                        |
| -------------- | --------------------- | ---------: | -----------: | -----: | ----------------: | ----------------------------- |
| Qwen 3.7 Flash | Raw MCP catalogs      |         13 |      344,833 | 88.4 s |                 3 | Incorrect CAPTCHA claim       |
| Qwen 3.7 Flash | Guarded browser tools |          4 |       17,143 | 19.7 s |                 2 | Correct                       |
| Luna           | Raw MCP catalogs      |          4 |       72,003 | 30.5 s |                 2 | Correct after a command error |
| Luna           | Guarded browser tools |          3 |        5,992 | 15.7 s |                 2 | Correct                       |

This establishes the tool boundary, not the complete product. The published-form Tally acceptance
test still requires the explicit authenticated-profile setting, opaque mail verification tools, and
human approval for the external create/publish action.

If the run encounters a CAPTCHA or another blocked step, the Workflow waits without holding a
running action. The admin UI exposes the protected Firecrawl live view. After the admin completes
the step, a mutation resumes the same Workflow and Agent thread.

## State and debugging

Each store has one job:

- `scoutRuns` is the current product state and final result.
- `scoutRunEvents` is the sanitized timeline shown in the product.
- The Agent component stores private model messages and tool calls.
- The Workflow component stores execution history and wait state.
- Firecrawl stores browser profile and session data.

The first admin view needs the run status, current step, sanitized event timeline, last failure,
model usage, Firecrawl credits, and protected live-view or replay links. Convex reactive queries can
update that view. Scout does not need OpenTelemetry or a separate tracing product for this version.

Retries depend on the operation. Model calls, inbox polls, and read-only browser inspection may
retry. A browser action that may have submitted a form or created data must not retry blindly. The
agent first inspects the current page and decides whether the action already succeeded.

Every run has limits for model turns, elapsed time, and Firecrawl credits. Reaching a limit stops the
run with an explicit reason. Automatic model routing is out of scope. Luna is the default, and an
admin may retry a failed experiment with Sol when comparison is useful.

## Acceptance test

Use the existing Tally mission as the first end-to-end test. The Convex-native runner passes when it:

- Creates and publishes the requested form without a Codex Desktop task or another worker service.
- Shows useful progress in the admin UI while the run is active.
- Pauses and resumes through the human-handoff path.
- Keeps inbox contents, verification data, and protected browser URLs out of public events.
- Reports the outcome, model usage, Firecrawl credits, and elapsed time.

The goal is reliable enough behavior at a supportable cost. Matching the Codex runtime step for
step is not a requirement.

## Deferred alternatives

Cloudflare Containers with the Codex SDK would preserve more Codex behavior. They would also add a
second deployed runtime, process lifecycle, queue coordination, callback authentication, and another
debugging path. Scout will reconsider this option only if the Convex-native acceptance test exposes
a specific missing capability.

A standalone OpenAI Agents SDK worker has the same operational problem with less benefit. LangChain,
Stagehand, and browser-use would duplicate orchestration or browser features that Convex and
Firecrawl already provide. A Firecrawl research agent may remain useful as one tool, but it does not
own Scout run state.

## Implementation order

1. Upgrade Convex to a version that supports AI Gateway and register the Agent and Workflow
   components.
2. Wrap the existing Firecrawl, AgentMail, completion, failure, and human-handoff operations as
   agent tools.
3. Add the bounded agent step and the durable run Workflow.
4. Run the Tally acceptance test from private Convex controls.
5. Build the smallest admin run list and run detail view around the proven data.
