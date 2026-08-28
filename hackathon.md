# Hackathon log

- **Project:** Scout
- **Event:** Convex All Gas Hackathon
- **What it does:** Will test web apps through fresh-user journeys and record whether their claims hold.
- **Live app:** https://usable-spider-599.eu-west-1.convex.site
- **Repo:** private
- **Frontend:** Convex static hosting
- **Convex deployment:** https://usable-spider-599.eu-west-1.convex.cloud
- **Components:** @convex-dev/agent, @convex-dev/static-hosting
- **Convex features:** schema, tables, indexes, queries, paginated queries, realtime queries, mutations, actions, scheduled functions, HTTP actions, AI Gateway
- **Auth:** Convex Auth
- **AI models:** gpt-5.6-sol, openai/gpt-5.6-luna and qwen/qwen3.7-flash (Convex AI Gateway)
- **Started:** 2026-08-26T16:12:42Z
- **Last updated:** 2026-08-28T22:15:12Z

## Log

### 2026-08-26 - 81be5f8

Started from the Samebase app template with Convex Auth, realtime guest todos, TanStack Start,
Cloudflare Workers deployment, and branch previews (`convex/`, `src/`, `wrangler.jsonc`).

### 2026-08-26 - 7bad4f6

Named the project Scout and documented its purpose as fresh-user trust testing for web apps
(`README.md`, `package.json`, `src/routes/__root.tsx`).

### 2026-08-26 - 8c82e03

Added a manual Convex Static Hosting deployment for the production SPA. Registered the Static
Hosting component and kept the existing Convex Auth HTTP routes ahead of the static fallback
(`convex/convex.config.ts`, `convex/http.ts`, `package.json`).

### 2026-08-26 - d23a2e3

Made successful production Cloudflare Workers deploys publish the same frontend files to Convex
Static Hosting. Preview, dry-run, and local deploys leave the production Convex site unchanged
(`scripts/deploy-cloudflare.ts`, `scripts/deploy-cloudflare.test.ts`).

### 2026-08-26 - a06fb1e

Shared one prerender route map between Cloudflare and Convex Static Hosting. Added a local
`rewritePath` patch so exact public routes serve their prerendered HTML while unknown routes keep
the SPA fallback (`prerender.config.ts`, `convex/http.ts`, `patches/`).

### 2026-08-26 - f0b0772

Added a private run and event ledger for Scout missions, including explicit running, human-handoff,
completion, failure, and browser-session states (`convex/schema.ts`, `convex/scout/model.ts`,
`convex/scout/runs.ts`).

### 2026-08-26 - e7c3847

Added private Convex actions that create, drive, and stop Firecrawl browser sessions and read the
Scout inbox through AgentMail. Verification links and codes can enter the browser without being
returned to the operator (`convex/scout/browser.ts`, `convex/scout/mail.ts`, `convex/scout/lib/`).

### 2026-08-27 - dd46aef

Added profile-backed Firecrawl Interact runs that start from a scrape, accept focused prompts or
measured code fallbacks, and explicitly stop to save browser state. The private event ledger now
separates prompt outcomes from fallback reasons without storing signed browser URLs
(`convex/scout/browser.ts`, `convex/scout/runs.ts`, `convex/scout/lib/firecrawl.ts`).

### 2026-08-27 - f164e8b

Completed a profile-backed Tally benchmark and verified a published form submission. Added Bash
code fallback support, preserved safe provider diagnostics, distinguished replay links from live
views, and measured wall time across multiple fixed-lifetime browser sessions
(`convex/scout/browser.ts`, `convex/scout/runs.ts`, `convex/scout/lib/firecrawl.ts`).

### 2026-08-27 - 4bfb913

Defined the first production agent runtime as a Convex Agent and durable Workflow that use the
existing Firecrawl and AgentMail controls. Recorded the Tally acceptance test, human handoff,
debugging data, cost limits, and the reasons for deferring a separate container runner
(`docs/agent-runtime.md`).

### 2026-08-27 - b12c006

Added a merge-commit build label workflow that projects GitHub's total commit count, preserves pull
request commit SHAs for this log, and rejects mislabeled `main` commits in CI. Pull requests now end
with a mechanical log commit that replaces `working tree` with the final substantive commit SHA
before merge (`AGENTS.md`, `.github/workflows/ci.yml`, `scripts/`).

### 2026-08-27 - c9f4a03

Replaced anonymous guest sessions with admin-only email and password Convex Auth. Added verification
and reset codes delivered through Cloudflare Email Service, server-side access checks, and auth
tests while keeping public reads open (`convex/auth.ts`, `convex/access.ts`, `convex/email.ts`,
`src/components/auth-panel.tsx`).

### 2026-08-27 - 7924489

Upgraded Convex to 1.45 and registered the Agent component with its current required AI SDK peer
dependencies (`package.json`, `convex/convex.config.ts`, `convex/_generated/api.d.ts`).

### 2026-08-27 - 0bfc58b

Defined the Scout Agent on `openai/gpt-5.6-luna` through Convex AI Gateway. Added a private smoke
action that persists a thread and messages, then returns a deterministic reply proof
(`convex/scout/agent.ts`).

### 2026-08-27 - 86a8b91

Moved the Scout Agent and its private smoke action to the default Convex runtime while keeping the
persisted AI Gateway exchange unchanged (`convex/scout/agent.ts`).

### 2026-08-27 - 1064c64

Removed the template todo table, Convex functions, public list UI, and todo-only tests and
dependencies. Kept the shared server-side admin access helpers and admin authentication on a
Scout-specific landing page (`convex/schema.ts`, `convex/access.ts`, `src/routes/index.tsx`,
`src/lib/auth.test.ts`, `package.json`).

### 2026-08-27 - 5422fab

Removed the client import of the server auth policy and stopped pre-filling the allowlisted address.
The sign-in form is now generic while Convex continues to enforce admin-only access
(`src/components/auth-panel.tsx`).

### 2026-08-27 - fc42bb3

Added an account settings route and moved sign-out there. Account-aware navigation now works across
routes, and signed-out visitors can return directly to the sign-in screen
(`src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/settings.tsx`).

### 2026-08-27 - c6bd750

Changed the pull request workflow so agents rebase onto current `main`, number every pull request
commit by its reachable commit count, repair rewritten Hackathon references, and verify that every
logged SHA remains reachable (`AGENTS.md`).

### 2026-08-27 - 807b809

Added a repeat-safe password fixture account for preview deployments. Each successful preview
deploy creates or refreshes one verified account, while the production build has no seed step and
the backend rejects production seeding (`convex/devAuth.ts`, `scripts/build-cloudflare.ts`).

### 2026-08-27 - 05d946e

Added an admin-only Agent lab with persistent per-user threads, asynchronous Luna replies, saved
streaming deltas, paginated UI messages, and defensive tool-call rendering. The React client uses
the Convex Agent hooks and shadcn chat components (`convex/scout/lab.ts`,
`convex/scout/labGeneration.ts`, `src/routes/lab.tsx`, `src/components/ui/`).

### 2026-08-27 - 9a70087

Connected each Luna turn to the raw hosted Firecrawl and AgentMail MCP catalogs through short-lived
HTTP clients. Cloud development verification discovered all 52 tools and completed one read-only
call from each provider with persisted tool activity, a finite tool loop, and client cleanup after
stream consumption (`convex/scout/labGeneration.ts`, `package.json`).

### 2026-08-27 - d974573

v49 Defined forward-only Hackathon entry versions, versioned pull request publication, and one
reserved log-only finalizer. Existing entries remain unchanged, and obsolete finalizers and related
fixups are removed when pull request history is rewritten (`AGENTS.md`, `hackathon.md`).

### 2026-08-27 - 455a7ae

v52 Reduced the signed-out site to the Scout landing page and its one-sentence description. Removed the
template About route, hid admin navigation until sign-in, redirected signed-out private routes home,
and linked the Convex live app from the README (`src/routes/`, `prerender.config.ts`, `README.md`).

### 2026-08-27 - bd04cf8

Made Firecrawl code interactions Scout's default browser control after the Tally benchmarks showed
that provider prompt mode was slower, costlier, and harder to debug. Firecrawl still owns the remote
browser, live view, session, and persistent profile (`docs/agent-runtime.md`).

### 2026-08-27 - e0669c2

v59 Turned the admin Lab into a model-comparison workbench with recent thread switching, first-prompt
titles, Luna and Qwen selection, and persisted input/output usage plus real elapsed time for each
completed response. Kept the previous Lab API usable during staggered frontend/backend deploys
(`convex/scout/lab.ts`, `convex/scout/labGeneration.ts`, `convex/schema.ts`, `src/routes/lab.tsx`).

### 2026-08-27 - 59ceb61

v60 Replaced Qwen3.8 Flash with Qwen3.7 Flash for new Lab turns while retaining 3.8 as a historical
generation value, so existing conversation metadata remains valid. New turns accept only Luna or
Qwen3.7 Flash (`convex/scout/models.ts`, `convex/scout/lab.ts`, `src/routes/lab.tsx`).

### 2026-08-27 - a0d11c5

v63 Changed the Hackathon log workflow to carry at most one pending entry into the next substantive
commit instead of ending every pull request with a log-only finalizer. Final submission keeps an
explicit cleanup path (`AGENTS.md`).

### 2026-08-27 - 3ea46ca

v65 Added a guarded browser harness that converts structured actions into shell-quoted Firecrawl
`agent-browser` calls, keeps browser profile selection outside the model, and rejects failed session
cleanup. Added a four-tool read-only AgentMail allowlist, provider URL and diagnostic redaction, and
focused tests (`convex/scout/labTools.ts`, `convex/scout/lib/firecrawl.ts`,
`convex/scout/lib/redaction.ts`).

### 2026-08-27 - 40fc9c1

v66 Connected the guarded browser harness and read-only AgentMail allowlist to the private Convex Agent
Lab. Persisted Firecrawl credits, browser duration, and sanitized terminal failures beside model
usage, surfaced that evidence in the chat UI even when a response fails before streaming, and raised
the bounded tool loop from 12 to 24 steps. Read-only Tally checks completed correctly with both Luna
and Qwen3.7 Flash
(`convex/scout/labGeneration.ts`, `convex/scout/lab.ts`, `convex/schema.ts`,
`src/routes/lab.tsx`).

### 2026-08-27 - 0025f55

v67 Recorded the final raw-MCP versus guarded-tool Tally benchmark and the current security boundary:
the private Lab retains read-only mail activity and uses fresh browsers, while authenticated profile
selection and opaque verification tools remain acceptance-test work (`docs/agent-runtime.md`).

### 2026-08-28 - e208997

v69 Added reusable Scouts with AgentMail and Firecrawl connection metadata, safe authenticated projections,
structured mission-run linkage and legacy backfill, and runtime provider resolution with legacy
fallbacks plus focused tests (`convex/schema.ts`, `convex/scout/scouts.ts`, `convex/scout/runs.ts`,
`convex/scout/browser.ts`, `convex/scout/mail.ts`, `convex/scout/*.test.ts`).

### 2026-08-28 - 5f89fea

v71 Added authenticated Scouts list and detail views with provider connection metadata, recent structured
mission runs, an all-runs view, and top navigation; kept Lab experiments conceptually separate
(`src/routes/scouts.index.tsx`, `src/routes/scouts.$slug.tsx`, `src/routes/runs.tsx`,
`src/components/scout-run-list.tsx`, `src/routes/__root.tsx`).

### 2026-08-28 - 38c1589

v72 Added admin Scout registration and immutable Lab thread identity bindings. Trusted Convex runtime
now selects each thread's Firecrawl profile and closes the read-only AgentMail tools over one inbox;
disabled or missing linked identities fail closed, and generation metadata records the Scout
(`convex/schema.ts`, `convex/scout/scouts.ts`, `convex/scout/lab.ts`,
`convex/scout/labGeneration.ts`, `convex/scout/labTools.ts`, `convex/scout/browser.ts`,
`convex/scout/mail.ts`, `convex/scout/*.test.ts`, `docs/agent-runtime.md`).

### 2026-08-28 - 2fed78e

v73 Added an inline admin Scout registration form and explicit Scout/thread controls in Lab. The UI
disambiguates identities, keeps old experiments unassigned, blocks overlapping generations, and
preserves mobile and accessible form behavior (`src/routes/scouts.index.tsx`,
`src/routes/lab.tsx`).

### 2026-08-28 - 8f81cb5

v74 Prevented concurrent Lab generations from sharing one Scout browser profile. Convex now enforces a
per-Scout pending lease, atomically claims scheduled actions, expires never-started or terminated
actions through watchdogs, and lets the admin UI follow that durable state instead of orphaned Agent
stream status (`convex/schema.ts`, `convex/scout/lab.ts`, `convex/scout/labGeneration.ts`,
`convex/scoutLab.test.ts`, `src/routes/lab.tsx`, `docs/agent-runtime.md`).

### 2026-08-28 - a3a6fe1

v75 Added reusable first- and last-name website identities to Scouts while keeping legacy records and
internal upserts compatible. New admin registrations require a complete identity, the Convex Agent
receives explicit identity fields with escaped prompt values, and Scout detail pages expose the
configuration. Verified the flow on the development deployment: the registered Scout appeared in
Lab with its provider bindings and matching prior runs (`convex/schema.ts`, `convex/scout/model.ts`,
`convex/scout/scouts.ts`, `convex/scout/labGeneration.ts`, `convex/scout/*.test.ts`,
`src/routes/scouts.index.tsx`, `src/routes/scouts.$slug.tsx`).

### 2026-08-28 - c157750 - v76

Reset the experiment around one strict model: every Lab thread and generation belongs to one
registered Scout. Removed the unused mission-run tables, backend, and UI, deleted compatibility
paths for unassigned threads and incomplete identities, and kept Firecrawl code-mode plus scoped
AgentMail MCP tools in the active Convex Agent flow. Cleared development experiment history while
preserving authentication and the configured Scout (`convex/schema.ts`, `convex/scout/lab.ts`,
`convex/scout/labGeneration.ts`, `convex/scout/scouts.ts`, `src/routes/lab.tsx`,
`docs/agent-runtime.md`).

### 2026-08-28 - af5df4c - v78

Added a repository-level override for the generic Hackathon skill. New committed log entries append
the build version after the short SHA while preserving the skill's date-and-SHA prefix. Historical
committed entries remain unchanged (`AGENTS.md`).

### 2026-08-28 - 8777e15 - v80

Added a separate admin-only inventory for real third-party service accounts. Accounts retain their
Scout, service identity, and timestamped authentication evidence without storing credentials or
pretending that an earlier login still works. Provider bindings and Lab threads remain separate,
and focused tests cover authorization, normalization, duplicates, filtering, and evidence changes
(`convex/schema.ts`, `convex/scout/model.ts`, `convex/scout/serviceAccounts.ts`,
`convex/scout/serviceAccounts.test.ts`, `docs/agent-runtime.md`).

### 2026-08-28 - 85c692c - v81

Added the admin account-inventory experience. Scout cards summarize only services with real
accounts; Scout profiles separate runtime provider connections from service accounts and provide
an inline registration form. Account rows show the domain, identifier, and honest timestamped
authentication evidence without inventing missing-service placeholders
(`src/routes/scouts.index.tsx`, `src/routes/scouts.$slug.tsx`).

### 2026-08-28 - 62ac7c8 - v82

Hardened the inventory after adversarial review: malformed hostnames are rejected, opaque account
identifiers retain their exact case, write limits match every bounded list, and Scout cards wait for
both data sources before rendering. Removed the manual authentication-result mutation so future
evidence must come from a traceable browser journey (`convex/scout/serviceAccounts.ts`,
`convex/scout/serviceAccounts.test.ts`, `src/routes/scouts.index.tsx`,
`docs/agent-runtime.md`).

### 2026-08-28 - f670327 - v83

Made service accounts visually recognizable without manual branding data. Scout lists and profiles
load each service's own HTTPS favicon, deduplicate services by domain, and fall back to a local
initial tile when a site has no root icon (`src/components/service-icon.tsx`,
`src/routes/scouts.index.tsx`, `src/routes/scouts.$slug.tsx`).

### 2026-08-28 - f96635e - v85

Moved Scout's Firecrawl adapter from scrape-bound Interact to standalone Browser Sandbox sessions
with persistent profiles and provider billing metrics. Added typed rate-limit details, bounded
explicit-429 retries, request deadlines for cleanup, and honest detection of failed browser commands
(`convex/scout/lib/http.ts`, `convex/scout/lib/firecrawl.ts`,
`convex/scout/lib/firecrawl.test.ts`).

### 2026-08-28 - 9afeb2f - v86

Made the Convex Agent browser lifecycle deterministic under parallel tool calls and provider
failures. Fixed waits now happen locally, open and close serialize safely, cleanup is idempotent and
bounded, and each generation records its terminal state before best-effort AgentMail shutdown
(`convex/scout/labTools.ts`, `convex/scout/labGeneration.ts`,
`convex/scout/labTools.test.ts`, `convex/scout/labGeneration.test.ts`). A live development benchmark
then ran Qwen 3.7 Flash and Luna for three 24-step generations each: all six browser sessions avoided
the prior rate-limit failure and closed cleanly, but neither completed the publish-and-verify mission.
Qwen used 15 Firecrawl credits and 1.91 million input tokens; Luna used 14 credits and 1.34 million,
making useful work per model step and repeated browser history the next measured bottlenecks.

### 2026-08-28 - 694a408 - v88

Stopped successful model work from being reported as a failure when Firecrawl's close response
times out after the session has already disappeared. Cleanup now confirms uncertain deletes against
the active-session list, and a generation that later fails cleanup retains its known model usage
without being marked successful (`convex/scout/labGeneration.ts`, `convex/scout/lab.ts`,
`convex/scout/lib/firecrawl.ts`, `convex/scoutLab.test.ts`,
`convex/scout/lib/firecrawl.test.ts`).

### 2026-08-28 - 41ec4ab - v89

Turned the failed monolithic browser mission into bounded, observable stages. Atomic mutations now
return their new compact page state, while a numeric CSS count can verify repeated visual semantics
without copying screenshots or raw HTML. A staged Qwen run submitted one Tally response; a fresh
Qwen verifier independently confirmed one completed response, the exact marker, and three filled
stars in 89.2 seconds using 3 Firecrawl credits. Raw HTML and the unproven batch runner were rejected
before commit (`convex/scout/agent.ts`, `convex/scout/labTools.ts`,
`convex/scout/labTools.test.ts`, `docs/agent-runtime.md`).

### 2026-08-28 - f170b24 - v91

Added admin-only Lab experiments that group technical threads by Scout, target product and domain,
objective, and active or completed status. New threads now derive their Scout from the selected
experiment. Existing threads remain visible as ungrouped history and can be assigned explicitly in
one bounded batch without changing messages, generations, or tool activity. The Lab now provides
linkable experiment and thread navigation, creation and status controls, and tested migration safety
(`convex/schema.ts`, `convex/scout/lab.ts`, `convex/scoutLab.test.ts`, `src/routes/lab.tsx`,
`docs/agent-runtime.md`).

### 2026-08-28 - working tree

Hardened Lab experiments after adversarial review. Thread history is paginated instead of silently
ending at 50, explicit URLs never fall through to another experiment or thread, browser navigation
cannot carry a stale draft into a different attempt, and the assignment flow owns the constrained
mobile workspace. Disabled Scouts remain available for historical organization without regaining
execution access. Cross-user assignment, disabled-Scout organization, and multi-page history are
covered by focused tests (`convex/scout/lab.ts`, `convex/scoutLab.test.ts`, `src/routes/lab.tsx`,
`docs/agent-runtime.md`).
