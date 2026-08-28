# Scout agent runtime

Scout is an experimental admin Lab. It does not define a public mission, report, or testing product
model yet.

## Data model

A Scout is a persistent identity configured by an admin. Each Scout has:

- A required first and last name for website forms.
- Runtime provider bindings for an AgentMail inbox and a Firecrawl profile.
- An active or inactive status.

Provider bindings are infrastructure used to run the Scout. They are separate from third-party
service accounts such as Tally or GitHub.

`scoutServiceAccounts` records only accounts that exist. Each record stores the Scout, service name,
service domain, account identifier, and timestamped authentication evidence. The evidence describes
the last check. It does not claim that the login still works.

New registrations start with unchecked evidence. The app must record a succeeded or failed check
only when a browser journey can attach traceable provenance, not from a manual admin assertion.

One Scout can have many service accounts. A future run or journey can use many accounts, and the same
account can be reused across runs. Service accounts therefore do not belong to Lab threads.

An experiment is an admin-only Lab grouping for one product test. It records a name, one Scout, the
target product and domain, one overall objective or claim, and an active or completed status. Its
status organizes the Lab. It is not an execution stage or workflow state.

A Lab thread is one technical agent attempt inside an experiment. New threads derive their Scout
from the selected experiment, and the Scout binding cannot change later. Threads created before
experiments remain visible as ungrouped history until an admin explicitly assigns them to an
experiment with the same Scout. Assignment changes only the Lab binding. It does not move or rewrite
the Agent messages or generation records.

A generation is one technical model turn inside a Lab thread. It stores model, tool, status, and
usage metadata. The generation uses the AgentMail inbox and Firecrawl profile from the thread's
Scout. The model cannot select another provider identity.

## Runtime boundary

Convex stores Scouts, Lab experiments, thread bindings, generation records, and Agent component
messages. The Convex AI agent runs each generation and exposes the tools used by the Lab. Firecrawl
owns remote browser sessions. AgentMail owns inboxes and received messages.

The app resolves provider credentials from the bound Scout before a generation starts. This keeps
identity selection in application code instead of model arguments.

Service-account inventory stores no passwords, tokens, cookies, or browser sessions. Provider
systems own credentials and browser state. A missing account is not an inventory record. Future
mission preflight will compare mission requirements with the accounts that exist.

## 2026-08-28 browser-agent experiment

A monolithic 24-step Qwen Tally creation run reached the editor but failed. A monolithic Luna run
created and published the requested two-question form, but did not submit a response or verify the
result. A staged Qwen run submitted the response and confirmed the dashboard count. It used 226,318
input tokens, 3,650 output tokens, 142.1 seconds, and 5 Firecrawl credits, but did not verify the
visual rating.

The first read-only Qwen verifier confirmed the count and marker, but not the rating. It used 303,096
input tokens, 10,255 output tokens, 152.6 seconds, and 5 credits. A raw HTML fallback then failed and
was rejected because it exposed broad hidden-data and resource risks. A safe CSS count verifier
independently confirmed one response, the exact marker, and 3 filled stars. It used 82,096 input
tokens, 4,215 output tokens, 89.2 seconds, and 3 credits. Cleanup left zero active Firecrawl sessions.

Default to bounded Qwen stages. Carry profile-backed provider state between fresh sessions with an
explicit artifact URL and checkpoint. Use stronger-model recovery only after evidence of no
progress, and keep verification separate. Retain compact post-mutation snapshots and failed-run
usage, use the safe CSS count fallback when needed, and confirm session cleanup. Do not add mission
or stage tables, retry or evidence records, durable session handles, or mirrored provider records
yet. These stages are prompting behavior inside technical threads, not durable product entities.
Keep experiment evidence in the existing Lab threads.

## Experimental cleanup

The current model replaces the earlier standalone Runs system. The cleanup removes:

- `scoutRuns` and `scoutRunEvents`.
- The standalone browser and mail actions tied to those records.
- The Runs route and UI.
- Unassigned Lab history and compatibility paths for threads without a Scout.

That earlier cleanup treated development Runs as disposable and did not migrate them. The current
experiment model is different: it preserves every bound Lab thread as grouped or ungrouped history
until an admin explicitly assigns it. The earlier cleanup preserved configured Scouts,
authentication data, and provider environment variables.

Do not add mission, report, planner, execution-orchestration, or durable browser-session entities.
Do not add an absent-account catalog or account-to-thread links until Lab experiments show which
product data must persist beyond a model thread.
