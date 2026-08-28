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
- **Last updated:** 2026-08-27T23:43:50Z

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

### 2026-08-27 - working tree

Recorded the final raw-MCP versus guarded-tool Tally benchmark and the current security boundary:
the private Lab retains read-only mail activity and uses fresh browsers, while authenticated profile
selection and opaque verification tools remain acceptance-test work (`docs/agent-runtime.md`).
