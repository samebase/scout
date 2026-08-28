# Scout agent runtime

Scout is an experimental admin Lab. It does not define a public mission, report, or testing product
model yet.

## Data model

A Scout is a persistent identity configured by an admin. Each Scout has:

- A required first and last name for website forms.
- An AgentMail inbox ID and email address.
- A Firecrawl profile.
- An active or inactive status.

A Lab thread belongs to one active Scout. The binding is required when the thread is created and
cannot change later.

A generation is one technical model turn inside a Lab thread. It stores model, tool, status, and
usage metadata. The generation uses the AgentMail inbox and Firecrawl profile from the thread's
Scout. The model cannot select another provider identity.

## Runtime boundary

Convex stores Scouts, thread bindings, generation records, and Agent component messages. The Convex
AI agent runs each generation and exposes the tools used by the Lab. Firecrawl owns remote browser
sessions. AgentMail owns inboxes and received messages.

The app resolves provider credentials from the bound Scout before a generation starts. This keeps
identity selection in application code instead of model arguments.

## Experimental cleanup

The current model replaces the earlier standalone Runs system. The cleanup removes:

- `scoutRuns` and `scoutRunEvents`.
- The standalone browser and mail actions tied to those records.
- The Runs route and UI.
- Unassigned Lab history and compatibility paths for threads without a Scout.

Development data is disposable during this phase. The cleanup does not migrate old Runs or
unassigned threads. It preserves configured Scouts, authentication data, and provider environment
variables.

Do not add a mission or report entity until Lab experiments show which product data must persist
beyond a model thread.
