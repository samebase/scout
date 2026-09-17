# Hackathon log

- **Project:** Scout
- **Event:** Convex All Gas Hackathon
- **What it does:** Offers browser play and product reviews with persistent Scouts, public activity, and a lab for chats, connected accounts, and replay.
- **Live app:** https://usable-spider-599.eu-west-1.convex.site
- **Repo:** private
- **Frontend:** Convex static hosting
- **Convex deployment:** https://usable-spider-599.eu-west-1.convex.cloud
- **Components:** @convex-dev/agent, @convex-dev/r2, @convex-dev/static-hosting, @convex-dev/workflow
- **Convex features:** schema, tables, indexes, queries, paginated queries, realtime queries, mutations, actions, scheduled functions, HTTP actions, AI Gateway
- **Auth:** Convex Auth
- **AI models:** qwen/qwen3.7-flash, openai/gpt-5.6-luna, deepseek/deepseek-v4-flash-0731 (Convex AI Gateway); gpt-5.6-luna (OpenAI Agents API experiment)
- **Started:** 2026-08-26T16:12:42Z
- **Last updated:** 2026-09-17T13:29:36Z

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

### 2026-08-28 - 11930c7 - v92

Hardened Lab experiments after adversarial review. Thread history is paginated instead of silently
ending at 50, explicit URLs never fall through to another experiment or thread, browser navigation
cannot carry a stale draft into a different attempt, and the assignment flow owns the constrained
mobile workspace. Disabled Scouts remain available for historical organization without regaining
execution access. Cross-user assignment, disabled-Scout organization, and multi-page history are
covered by focused tests (`convex/scout/lab.ts`, `convex/scoutLab.test.ts`, `src/routes/lab.tsx`,
`docs/agent-runtime.md`).

### 2026-08-29 - f96073e - v94

Added the authenticated Product registry that unifies explicit admin entries, Scout service
accounts, and Lab experiment targets by canonical domain. The Products page adds and deduplicates
products, reports Scout access and experiment use, and keeps claim investigations inline with an
explicit unverified-evidence boundary (`convex/schema.ts`, `convex/products*.ts`,
`convex/scout/serviceAccounts.ts`, `convex/scout/lab.ts`, `src/routes/products*.tsx`).

Product investigation now maps a first-party site, optionally performs one domain-constrained
search, scrapes at most six validated pages, and gives at most 36,000 characters to one fresh,
tool-free Luna Agent thread. Opaque source IDs are hydrated only to retrieved URLs, excerpts must
occur on their cited page, Firecrawl use is conservatively capped at nine credits, and a four-minute
watchdog rejects stale completion while retaining the previous completed report. A direct
Firecrawl Agent baseline was rejected after a 15-minute Samebase timeout, and Convex Gateway
structured output was rejected after a reproducible HTTP 400; the accepted single text generation
uses bounded JSON and Zod validation (`convex/productResearchAgent.ts`,
`convex/productsInvestigation.ts`, `convex/productsResearch.ts`, `convex/products.test.ts`).

Live development investigations then completed for Samebase, Tally, and Otio at seven
conservatively counted Firecrawl credits each. Their expanded reports cited five, four, and five
actual first-party pages. Tally surfaced the qualification between unlimited free usage and
unstated fair-use limits; Otio surfaced no-file-cap language against explicit upload and storage
quotas, plus an unclear OCR dependency. The final check passed 160 tests and the complete
Cloudflare build path passed. An independent cross-model review found no P0-P2 issues; its two P3
findings were fixed by aligning the visible registry cap and making the page await every bounded
legacy-sync cursor (`docs/agent-runtime.md`, `.audit/products-investigation.tsv`).

### 2026-08-29 - a8f662a - v96

Fixed the Products page staying in its loading state after React's development effect remount. The
page now shares one legacy-sync promise while each mounted effect attaches its own live completion
handler, avoiding both an abandoned result and duplicate mutation runs. A full browser reload now
reaches the Product list, and the complete check and Cloudflare build path pass 160 tests
(`src/routes/products.index.tsx`).

### 2026-08-29 - b66c214 - v98

Turned the Product registry into a resizable workspace using the published `@samebase/sidebars`
package. A compact, filterable product index now drives a linkable dossier pane; desktop widths
persist across reloads, keyboard resizing is accessible, and mobile selection returns to the main
dossier without losing the product context (`src/sidebars/`, `src/routes/products*.tsx`,
`src/style.css`).

### 2026-08-29 - b4a8bc5 - v100

Added an authenticated research reset for Products. It refuses to interrupt queued or running
work, returns completed or failed Products to the uninvestigated state, and preserves the underlying
attempt records for future audit history. The Products workspace confirms the reset inline on
desktop and mobile, with backend coverage for authorization, active-run safety, repeat calls, and a
fresh subsequent investigation (`convex/products.ts`, `convex/products.test.ts`,
`src/routes/products.index.tsx`).

### 2026-08-29 - c90c3ca - v103

Separated Lab history from other Agent threads after a Product investigation thread caused the
entire Lab query to fail. The Lab now paginates its own authenticated thread bindings and hydrates
only those Agent records, while direct access still rejects unbound threads. Product investigations
also report their live mapping, source-selection, page-reading, and claim-summarization stage rather
than showing one opaque spinner until completion (`convex/schema.ts`, `convex/scout/lab.ts`,
`convex/scoutLab.test.ts`, `convex/products*.ts`, `src/routes/products.index.tsx`).

### 2026-08-29 - c54fc78 - v104

Moved Product research onto a durable Convex Workflow and added an authenticated activity ledger.
The resizable Products inspector now shows each sanitized Firecrawl map, search, and scrape request,
per-call timing and credit use, the Agent generation configuration, and the reactive Workflow step
history without returning authorization headers, scraped Markdown, prompts, or raw Workflow data.
External provider actions do not retry automatically, and terminal failures close any in-flight
activity transactionally (`convex/productInvestigationWorkflow.ts`,
`convex/productsInvestigation*.ts`, `convex/products.ts`, `convex/schema.ts`).

The Products dossier and report now respond to their pane's width instead of the browser viewport,
so resizing either sidebar cannot collapse product identity, status, metadata, or controls. A live
Samebase refresh exposed all provider operations and completed at seven Firecrawl credits. The full
check passed 163 tests and the Cloudflare build path passed after adversarial backend, UI, desktop,
and mobile review (`src/routes/products.index.tsx`, `convex/products.test.ts`).

### 2026-08-29 - 5bba27e - v106

Replaced Product query-ID selection with canonical domain routes and added a dedicated, linkable
three-pane claim workspace. Content-derived claim keys stay attached to the same evidence across
research reordering, while malformed domains, missing products, absent investigations, empty
reports, and stale claim keys render distinct states without rewriting stored research
(`convex/products.ts`, `convex/productsModel.ts`, `src/components/products-workspace.tsx`,
`src/routes/products.$domain*.tsx`).

The claim list, evidence dossier, proposed test, and explicit Lab handoff respond to pane width and
switch cleanly between mobile panes. Bundling the published sidebar package during SSR also restored
direct-route development loads and prerender. The full check passed 164 tests and the complete
Cloudflare build path passed after adversarial route review and live browser verification
(`vite.config.ts`, `convex/products.test.ts`).

### 2026-08-29 - b0544a9 - v107

Connected each researched claim to an exact investigation snapshot and an automatically created
Scout verification run. Starting a test now creates its Lab experiment, thread, prompt, scheduled
generation, and audit link in one mutation; repeated clicks reuse pending work, while terminal runs
can be retried. The claim page reacts to the same Agent transcript and separates the compact verdict
from the browser/tool trace and full raw Lab transcript (`convex/claimTests*.ts`,
`convex/productsClaims.ts`, `convex/scout/lab.ts`, `src/components/scout-run-message.tsx`,
`src/routes/products.$domain.claims.$claimKey.tsx`).

Fresh investigations now synthesize at most six concrete, bounded, testable claims rather than a
long product-description inventory. A live Samebase refresh produced six claims, and its pricing
claim completed as Supported in 102.6 seconds using four Firecrawl credits while streaming the
Scout's browser operations. The product report now leads with that short claim queue and keeps
secondary research collapsed. The full check passed 168 tests and the complete Cloudflare build
path passed; desktop pane resizing, the 390-pixel mobile flow, and exact raw-run navigation were
verified in the browser (`convex/productsResearch.ts`, `convex/productsValidation.ts`,
`src/components/products-workspace.tsx`).

### 2026-08-29 - d018426 - v109

Redesigned every Scout route around one compact, responsive application shell with clearer
navigation, stronger information hierarchy, consistent controls, deliberate empty and loading
states, and light and dark system themes. Home, authentication, Lab, Scouts, Products, claims, and
Settings now share the same visual language across desktop and mobile
(`src/components/app-navigation.tsx`, `src/routes/`, `src/style.css`).

Added Taste Skill as a project-local, versioned design guide so future interface work can reuse the
same standards. The full check passed 168 tests and the production Cloudflare build passed;
browser coverage included every route plus populated, empty, signed-out, and 390-pixel mobile
states. Production Lighthouse scored 97 performance, 100 accessibility, 96 best practices, and 100
SEO (`.agents/skills/design-taste-frontend/SKILL.md`, `skills-lock.json`).

### 2026-08-29 - 00263c9 - v110

Recorded Scout's current UI direction in a short design contract that future agents can use as a
cache instead of reconstructing the system from every route. The contract explicitly yields to
new product evidence, user requirements, accessibility needs, and the source code, and it records
the current design read, Taste Skill dials, ownership map, defaults, exceptions, and verification
path (`docs/ui-design-contract.md`, `AGENTS.md`).

### 2026-08-29 - 71fb342 - v112

Embedded Firecrawl's read-only live browser in the claim workspace while a Scout test is active.
The signed provider URL is validated at the Firecrawl boundary, kept out of the Agent transcript,
exposed only through an authenticated owner-scoped realtime query, and deleted when the browser or
generation closes (`convex/claimTests*.ts`, `convex/scout/labGeneration.ts`,
`convex/scout/lib/firecrawl*.ts`, `src/routes/products.$domain.claims.$claimKey.tsx`).

The live session uses Scout's shared controls and container-responsive pane styling, so the browser
remains the primary work surface as the center pane changes width.

Removed rounded accent-rail containers from Product and claim headings while keeping real
investigation status inline. The Scout design contract and project-local Taste preflight now ban
that motif; desktop and 390-pixel mobile checks covered both routes
(`src/components/products-workspace.tsx`, `docs/ui-design-contract.md`,
`.agents/skills/design-taste-frontend/SKILL.md`).

A live Samebase verification showed the iframe move from GitHub sign-in to Samebase documentation
alongside the tool trace, then disappear on `browser_close` while the verdict remained. The run used
three Firecrawl credits and 82.2 browser seconds; all 174 tests and the complete Cloudflare build
path passed.

### 2026-08-29 - 8b60948 - v114

Removed the vendored Taste Skill and UI design contract after using them showed that their
landing-page focus did not fit Scout's dense product workflows. Removed the mandatory agent
instructions and skill lock entry while keeping the interface redesign. Replaced the light page and
authentication background tints with neutral surfaces. The full check passed 174 tests, the
production build passed, and desktop and 390-pixel mobile views passed browser verification
(`.agents/skills/design-taste-frontend/SKILL.md`, `docs/ui-design-contract.md`, `AGENTS.md`,
`skills-lock.json`, `src/style.css`, `src/routes/index.tsx`).

### 2026-08-29 - 2180348 - v116

Made the Product claim queue show each current claim's latest owner-scoped run state as Untested,
Testing, Tested, or Test failed. The status is a realtime Convex query over the exact investigation
snapshot, so another account's run and an older investigation cannot mark a claim as tested
(`convex/claimTests*.ts`, `src/components/products-workspace.tsx`).

The live Samebase queue showed two green Tested labels and four neutral Untested labels at both full
and 390-pixel pane widths. All 174 tests, the Convex development push, and the complete Cloudflare
build path passed.

New claim-test attempts now use Qwen 3.7 Flash through Convex AI Gateway. The choice is scoped to
claim verification: product investigation and ordinary Lab runs keep their existing model defaults
(`convex/claimTests.ts`, `convex/claimTests.test.ts`).

### 2026-08-29 - 4d0bd2f - v117

Saved each new claim test's Firecrawl browser session and added an authenticated replay surface to
the completed run. Scout stores only the provider session ID; Convex actions fetch fresh replay
metadata and HLS playlists when needed, keeping the Firecrawl key and signed recording links out of
the database and public queries (`convex/claimTestReplay.ts`, `convex/claimTests.ts`,
`convex/scout/lib/firecrawl.ts`, `src/routes/products.$domain.claims.$claimKey.tsx`).

The player skips Firecrawl's blank bootstrap tab, lets the operator switch among recorded tabs, and
lazy-loads HLS support. A new Samebase run completed with Qwen 3.7 Flash in 138.1 seconds using five
Firecrawl credits; its 110-second recording loaded in the claim page and played to 17.5 seconds.
All 178 tests and the complete Cloudflare build path passed.

### 2026-08-29 - 53d3c36 - v118

Reconstructed each claim test as one replay timeline across Firecrawl's per-tab recordings. Every
browser mutation now records its exact run, session, tool call, action sequence, before and after
tab inventory, provider timestamp, and click box; an unknown post-dispatch outcome stops the run
instead of guessing or retrying it (`convex/claimTestBrowserModel.ts`, `convex/claimTests.ts`,
`convex/scout/browserTelemetry.ts`, `convex/scout/labTools.ts`, `convex/schema.ts`).

The claim page plays matched tabs on one clock, switches at the first observation that confirms a
tab change, marks captured clicks, and exposes ambiguous or unmatched provider tracks for manual
inspection instead of guessing. A clean Samebase pricing run recorded ten applied operations,
closed in 93.3 browser seconds using four Firecrawl credits, and played its 80-second real track in
both the wide and three-pane layouts while retaining one unmatched blank provider recording. All
189 tests and the complete Cloudflare build path passed
(`src/lib/claimReplayTimeline.ts`, `src/routes/products.$domain.claims.$claimKey.tsx`).

### 2026-08-29 - 77d28de - v119

Made Qwen 3.7 Flash the default for product research, Lab, and Scout, while keeping Luna available
only when selected. Product synthesis now discards generated array items beyond the documented
limits before validating retained claims, so Tally's malformed seventh claim no longer fails the
workflow (`convex/productsResearch.ts`, `convex/productsModel.ts`, `convex/scout/models.ts`).

Claim tests now start in a fresh Firecrawl browser, force a bounded close and final verdict, and do
not display a later matched video at 0:00 when the initial tab is ambiguous. A clean Tally run
created and edited a form anonymously, then observed both Preview and Publish open “Create your
Tally account,” producing a Refuted verdict in 122.7 seconds with four Firecrawl credits. All 189
tests and the complete Cloudflare build path passed (`convex/claimTests.ts`,
`convex/scout/labGeneration.ts`, `src/lib/claimReplayTimeline.ts`).

### 2026-08-30 - 9cfaca8 - v120

Made generated claims editable in place without changing their route or rewriting completed
research. Each user-scoped override stores the claim, starting URL, and test instructions; new runs
snapshot that exact target, while a later edit marks the preserved result and replay as Needs retest
(`convex/productClaimEdits.ts`, `convex/claimTests.ts`,
`src/routes/products.$domain.claims.$claimKey.tsx`).

A browser-driven Tally trial edited one claim, proved the Needs retest transition, and reran it with
Qwen 3.7 Flash. The Scout emitted two `browser_switch_tab` actions, the reconstructed replay showed
two tab-change markers across two recorded tracks, and the Product queue returned to Tested. All
191 tests, the Convex development push, and the complete Cloudflare build path passed.

### 2026-08-30 - ad50bdf - v121

Replaced the editable starting URL with one inspectable Scout prompt built from the Product name,
domain, primary URL, claim, and optional test instructions. Generated research URLs remain
read-only evidence; custom claims carry no fabricated research context
(`convex/claimTests.ts`, `convex/productClaimEdits.ts`, `convex/products.ts`).

Added owner-scoped custom claims and administrator controls to add, edit, and remove claims. Custom
claims survive renewed product research, generated removals are scoped to one investigation, and
test status follows custom claims across investigations (`convex/schema.ts`,
`src/components/products-workspace.tsx`, `src/routes/products.$domain.claims.$claimKey.tsx`).

A browser-driven Samebase check created a custom account-creation claim without instructions,
verified the generated product-aware prompt, edited the instructions, and removed the claim. All
193 tests, the Convex development push, and the complete Cloudflare build path passed.

### 2026-08-30 - f5d4e56 - v122

Collapsed generated claim edits and removals into one mutually exclusive override record. Claim
test runs now use one stable claim key and always retain the exact claim and instructions they
tested; legacy starting-URL snapshots and duplicate custom-claim run IDs were removed instead of
preserved through migration code (`convex/schema.ts`, `convex/productClaimEdits.ts`,
`convex/claimTests.ts`).

Backed up the development deployment, cleared only incompatible claim-test and override records,
and pushed the narrowed schema. A browser-driven Samebase check edited and removed a generated
claim, then created, edited, and removed a custom claim. All 193 tests, the Convex development push,
and the complete Cloudflare build path passed.

### 2026-08-30 - 93c0341 - v124

Added one-shot human takeover for claim tests. A CAPTCHA or other human-only browser result now
emails the authenticated operator one validated Firecrawl interactive link, shows the same session
on the claim page, and resumes Scout only after the operator explicitly continues
(`convex/claimTestHumanHandoffs.ts`, `convex/scout/claimTestLoop.ts`,
`src/routes/products.$domain.claims.$claimKey.tsx`).

A live GitHub signup reached a DataDome challenge and delivered the takeover email and interactive
session. The request now allows five minutes and recommends desktop after mobile drag controls
proved unreliable. Expiration produces a deterministic Inconclusive result even when the model does
not complete its forced close turn. All 225 tests, the Convex development push, and the complete
Cloudflare build path passed.

### 2026-08-30 - 67536d8 - v127

Made Product → Claim → Run the inspectable testing hierarchy. One Claim can now keep multiple Runs;
one Run can continue through multiple worker generations and temporary Firecrawl browser sessions.
The dense three-pane workspace exposes run state, session activity, human takeover, live browser,
per-tab replay, click markers, result, and service-account evidence without adding a general mission
or orchestration framework (`convex/claimTests.ts`, `convex/claimTestRunModel.ts`,
`src/components/claim-run-workspace.tsx`, `src/components/claim-run-replay.tsx`).

Added persistent Scout browser profiles and trusted account-creation boundaries. The model cannot
read the configured password, credential fill is restricted to verified password inputs on the
tested product domain, and a conclusive successful account run records authenticated identity and
session-control evidence against the Scout. A live GitHub run completed CAPTCHA takeover, email
verification, account creation, account recording, and replay. All 247 tests, the Convex development
push, and the complete Cloudflare build path passed (`convex/scout/labGeneration.ts`,
`convex/scout/serviceAccounts.ts`, `convex/claimTestHumanHandoffs.ts`).

### 2026-08-30 - 5babc67 - v129

Added managed Scout passwords encrypted with AES-256-GCM in Convex. Public queries and the agent see
only safe account metadata. An account-creation Run must bind one exact prepared service-account ID
for its selected Scout and Product before it starts; every continued generation and browser session
reuses that ID. The recording tool accepts only account access and browser element refs; trusted
code derives the expected identifier from the bound account, verifies the visible identity, and
updates only that row instead of accepting another model-selected account
(`convex/scout/serviceAccountCredentials.ts`, `convex/scout/credentialCrypto.ts`,
`convex/claimTests.ts`, `convex/scout/serviceAccountTool.ts`,
`convex/scout/serviceAccounts.ts`, `src/routes/scouts.$slug.tsx`).

Reused the ref-based `fill_account_password` capability as the only password tool. Trusted server
code checks the exact HTTPS login host and password input types, decrypts the bound credential,
registers it for exact and URI-encoded output redaction, and fills through Firecrawl while telemetry
stores only refs and character counts. Managed Runs retain persistent profiles, replay, live view,
operation capture, and human takeover. Documented that Firecrawl receives plaintext and that Scout
cannot scrub provider-rendered replay or raise Firecrawl's undocumented recording quality
(`convex/scout/labGeneration.ts`, `convex/scout/labTools.ts`,
`docs/firecrawl-limitations.md`, `docs/scout-credential-store-decision.md`). All 272 tests, the
Convex development push, and the
complete Cloudflare build path passed.

### 2026-08-31 - 21e0ab5 - v130

Decoupled administrator-authored claims from product research. A Product can now expose, edit,
remove, and test a manual Claim before any investigation succeeds; generated Claims remain tied to
their completed investigation, while custom Claim Runs keep the Product → Claim → Run → Session
hierarchy without a fabricated research record (`convex/productClaimEdits.ts`,
`convex/claimTests.ts`, `src/components/products-workspace.tsx`). Removed the unused pre-Workflow
investigation action instead of preserving a second implementation.

A live Cloudflare run proved the path against a real account: the managed credential filled the
signup form without exposing its password, human takeover cleared Cloudflare's CAPTCHA, Scout read
the verification email, reached the authenticated dashboard, and recorded the created account
against Conrad's Product account. Replay retained both browser sessions and six operations; one
provider video remained explicitly unmatched because Firecrawl did not expose enough tab identity.
All 272 tests and the complete Cloudflare build path passed.

### 2026-08-31 - 8f538cb - v131

Raised the Qwen product-research synthesis ceiling from 6,000 to 16,000 output tokens after a
Cloudflare response spent nearly the entire smaller budget on reasoning and ended with incomplete
JSON. Kept the checked-in synthesis path to one Convex Agent `generateText` call followed by strict
JSON and Zod validation; no experimental `generateObject` or repair implementation remains
(`convex/productsInvestigationWorkflow.ts`). All 272 tests and the Convex development push passed;
a fresh Cloudflare investigation then completed live with six generated claims and seven Firecrawl
credits.

### 2026-08-31 - cc3999f - v132

Clarified the operator workflow in the UI. Product controls now use Research product, Refresh
product research, and Retry product research; each Claim exposes an Attempts list with New attempt,
Start attempt, and Continue attempt controls (`src/components/products-workspace.tsx`,
`src/components/claim-run-workspace.tsx`). The existing Product, Claim, Run, and Session data model
and routes remain unchanged. Verified both Cloudflare views in the local app, and all 272 tests and
the complete project check passed.

### 2026-08-31 - 7c98f9d - v133

Made product selection update inside the existing workspace instead of replacing all three panes
with a loading state. The selected Product now comes directly from the already-subscribed realtime
registry, removing a duplicate per-domain query (`src/components/products-workspace.tsx`). A live
route switch rendered the next dossier within 100 ms while only its claim statuses and research
activity loaded. All 272 tests and the complete project check passed.

### 2026-08-31 - aa29a55 - v134

Replaced the rigid Product → Claim → Run execution model with Product → Task → Attempt → Turn →
Browser Session. A Task is one editable free-form instruction, continuing it adds a Turn to the
same Attempt, and a clean retry creates another Attempt. Product research remains optional,
read-only context rather than executable schema; disposable claim-test data and legacy paths were
removed (`convex/tasks.ts`, `convex/scout/turns.ts`, `src/components/task-workspace.tsx`).

A live Cloudflare Task reused Conrad Scout's profile and authenticated account, completed two
operator-directed Turns across two browser Sessions, and retained operations and replay evidence.
The dense three-pane workspace exposes Attempts, live/replay/transcript views, and Sessions. All 201
tests and the complete Cloudflare build path passed.

### 2026-08-31 - a22bcf1 - v136

Added an explicit resolution to every Task Attempt: active, completed, blocked, or abandoned, with a
short conclusion for terminal outcomes. Resolution remains separate from Turn activity, so CAPTCHA
handoffs and failed Turns do not falsely end an Attempt; blocked and abandoned Attempts can resume,
while completed work starts a new Attempt (`convex/tasks.ts`, `convex/scout/taskLoop.ts`).

The Task workspace now shows resolution and current activity independently and exposes a reversible
operator abandon action only when no Turn or handoff is pending. Scout can resolve work only after a
persisted browser close, and a failed resolution write fails the Turn instead of reporting success.
All 211 tests, the complete project check, and the Convex development push passed.

### 2026-09-01 - 25d71cd - v139

Removed Firecrawl's never-active `about:blank` bootstrap recording from reconstructed replay
timelines when a real web recording starts alongside it. Replay now selects the sole correlated
track before the first telemetry sample, so video begins immediately without an unmatched tab or
misleading tab-change error; a blank tab that Scout actually activated remains available. Added
focused regression coverage and passed all 211 tests plus the complete project check
(`src/lib/taskReplayTimeline.ts`, `src/lib/taskReplayTimeline.test.ts`).

### 2026-08-31 - e7bc32a - v140

Replaced raw browser-takeover links with a first-party, short-lived handoff page bound to the exact
Task Attempt, Turn, browser Session, and operator. Convex stores only a capability digest, derives
ownership through the bound records on every access, and revalidates the exact active Firecrawl
session before exposing its current interactive view (`convex/taskHumanHandoffs.ts`,
`convex/taskHumanHandoffAccess.ts`, `src/components/human-handoff-page.tsx`).

Bound the action lifecycle to one email, one atomic Continue, one verified same-session snapshot,
and immediate browser close before Attempt resolution. Email and Firecrawl requests have transport
deadlines; expiry and delivery failure close without inventing a result. All 246 tests and the
complete Cloudflare production build passed.

### 2026-08-31 - cf19e93 - v141

Reused Convex Auth's `SITE_URL` as the one application origin for human-handoff links. The value is
validated when a handoff is created instead of blocking fresh Convex preview deployments that have
not configured the feature yet. Qwen-facing integer inputs now accept either JSON numbers or
decimal strings for browser waits and AgentMail limits, then normalize them before execution
(`convex/convex.config.ts`, `convex/scout/labGeneration.ts`, `convex/scout/labTools.ts`).

Added a second-by-second expiry countdown to the secure handoff page. All 254 tests, the complete
Cloudflare build path, and the Convex development push passed
(`src/components/human-handoff-page.tsx`).

### 2026-09-01 - f0c0565 - v142

Separated handoff delivery from live control: an unopened private link now remains claimable for 45
minutes, while its first valid open atomically starts a separate five-minute control window. A
durable Convex Workflow waits without holding the Scout action open, then snapshots and closes the
same Firecrawl browser before enqueueing the continuation Turn (`convex/taskHumanHandoffs.ts`,
`convex/taskHumanHandoffLifecycle.ts`, `convex/scout/labGeneration.ts`).

Removed the model-dependent forced handoff transition after Qwen exposed it as literal tool-call
text. A live Samebase checkpoint run proved email handoff creation, the two independent timers,
human completion, Continue, final snapshot capture, browser closure, and continuation enqueueing.
The complete project check passed with all 252 tests.

### 2026-09-01 - 69e0fcd - v143

Made post-handoff Attempt resolution provider-portable and consistent with the Task hierarchy. Qwen
now receives a clean final-judge step with only `resolve_attempt` available instead of a forced
tool-choice request rejected by the provider. Resolution verifies that every Browser Session for
the Attempt is closed rather than requiring the continuation Turn to own one
(`convex/scout/labGeneration.ts`, `convex/tasks.ts`).

Removed the focus refresh that could detach the Continue button before its click reached React. A
fresh Chrome and Gmail run completed the Samebase human checkpoint with one Continue click, two
Turns, one closed Browser Session, replay, and a persisted Completed conclusion. The complete
project check passed with all 253 tests (`src/components/human-handoff-page.tsx`).

### 2026-09-01 - 36f9201 - v144

Fixed private handoff links for logged-out browsers. The page now retains the emailed bearer in
per-tab session storage after removing it from the address bar, so repeated React effects and page
reloads cannot silently fall back to owner authentication (`src/lib/human-handoff-access.ts`).

Added a strict-effects regression that reproduced the anonymous failure before the fix. A fresh
emailed handoff then completed live in a clean browser with its transcript and final conclusion
preserved. All 254 tests and the complete Cloudflare build path passed
(`src/components/human-handoff-page.test.tsx`).

### 2026-09-01 - 2b872e1 - v145

Reduced the handoff lifecycle to one durable boundary: after Continue, the Workflow waits until
Scout has persisted its paused Turn, then captures and closes the existing browser once and enqueues
a browserless final-judge Turn. Removed the competing in-stream handoff states, post-handoff browser
reopen path, and dead compatibility outputs (`convex/taskHumanHandoffLifecycle.ts`,
`convex/scout/taskLoop.ts`, `convex/scout/labGeneration.ts`).

Browser cleanup now survives provider inspection and snapshot errors, continuation prompts are
bounded at the real Task limit, and destructive operator actions cannot race an active browser or
handoff. All 254 tests and the complete Cloudflare build passed. A live Samebase checkpoint verified
handoff claim, Continue, browser close, and a second Turn without a second browser; its final Qwen
judge request then recorded an upstream Convex AI Gateway HTTP 502 after three retries rather than
misreporting success.

### 2026-09-01 - f0d6bb2 - v147

Made every Scout service account declare how it can be used: either an encrypted managed password
or OAuth through one exact service-account record belonging to the same Scout. Account recording
can add a newly observed Task-product account only from trusted browser identity evidence, resolves
OAuth provider details to the stored account ID, and rejects unknown or mismatched login methods
(`convex/scout/model.ts`, `convex/scout/serviceAccounts.ts`,
`convex/scout/serviceAccountTool.ts`).

Migrated the development inventory to the required union and removed the previous optional
credential shape and temporary migration. Deleted the unused manual OAuth registration mutation,
leaving managed-credential registration and evidence-backed Task recording as the only creation
paths. The Scout detail page now shows each direct password or the concrete provider account used
for OAuth. The full project check passed with all 250 tests, and the Convex development push plus
local UI verification succeeded
(`convex/scout/serviceAccountCredentials.ts`, `src/routes/scouts.$slug.tsx`).

### 2026-09-01 - 0df04a8 - v150

Replaced every Scout-owned Firecrawl HTTP transport with the official `firecrawl` Node SDK for
Browser Sandbox, Map, Search, and Scrape. Scout keeps its product-level URL safety, credentials,
telemetry, human-handoff rules, and narrow CSS-count tool without recreating Firecrawl's HTTP,
error, or retry stack
(`convex/scout/lib/firecrawl.ts`, `convex/scout/labTools.ts`,
`convex/productsInvestigationWorkflow.ts`).

Preserved the replay feature, including the reconstructed cross-tab timeline and `hls.js` player.
Firecrawl exposes the two replay GET routes in its server but not its Node SDK or public OpenAPI
specification, so Scout isolates only those requests in one runtime-validated adapter. Browser
mutations use one SDK attempt to avoid duplicate actions, remote process failures are distinguished
from successful API requests, and ambiguous closes are reconciled through the SDK session list. A
local Convex development push, all 231 tests, and the complete Cloudflare build passed
(`convex/scout/lib/firecrawlReplay.ts`, `convex/taskReplay.ts`,
`src/components/task-replay.tsx`).

### 2026-09-02 - d80c3e9

Replaced the shell-based browser layer with Playwright and verified that Conrad can complete Samebase
onboarding and account deletion without human help. Longer attempts now expose steps and cost, retain
transcript location and errors, and visibly repair malformed provider tool arguments. Lab gained a
compact sidebar for repeatable model comparisons (`convex/scout`, `src/components/task-workspace.tsx`,
`src/routes/lab.tsx`).

### 2026-09-02 - 84aed3f

Made each pull request one shipped build through squash merging. Branch commits stay unversioned,
the pull request title projects the next main commit count, and one grouped Hackathon entry carries
forward to the next squash commit (`AGENTS.md`, `scripts/pr-build-label.ts`).

### 2026-09-03 - 7e215c5

Added a manual Lab driver for Scout's existing browser, mail, password, and diagnostic tools. Lab
threads now retain live views, Playwright operations, and replay while model context keeps only the
latest page snapshot; standard Playwright page APIs replace custom tab commands (`convex/scout/`,
`convex/taskReplay.ts`, `src/routes/lab.tsx`, `src/components/task-replay.tsx`).

Verified the flow by completing a Samebase app across GitHub, Cloudflare, and Convex, loading the
deployed app, replaying the multi-tab session, and deleting an earlier test app.

### 2026-09-03 - 25dfdc6

Made Scout chats the main interface and removed products, tasks, attempts, and experiment grouping.
Kept Scout identities and account connections, shared manual and model tools, and moved human
handoff into chats alongside live view, replay, and usage (`convex/schema.ts`, `convex/scout/`,
`convex/humanHandoffs.ts`, `src/routes/chats.tsx`).

### 2026-09-03 - c642308 - v163

Put the conversation beside the browser in resizable panes. The browser changes from live to replay
when its session closes, while the selected session stays in the URL (`src/routes/chats.tsx`,
`src/sidebars/scoutSidebarState.ts`).

### 2026-09-03 - c6e0810 - v164

Linked worktrees now reuse Samebase's local password-account flow: `pnpm run dev` starts an isolated
anonymous Convex database, seeds the standard development account, and shows one-click sign-in only
in that worktree (`scripts/run-worktree-dev.ts`, `src/components/auth-panel.tsx`).

### 2026-09-03 - 77d9dfd - v165

Made Scout's chat and browser-tool boundaries type-safe: provider payloads and saved message parts
are parsed once with Zod, tool variants carry required fields, and the UI renders a discriminated
transcript instead of probing unknown objects. Removed reflection and assertion chains, and encoded
the policy in repository instructions and Vite+ lint (`convex/scout/`, `src/`, `AGENTS.md`,
`vite.config.ts`).

### 2026-09-03 - 22ba98d - v166

Preserved complete provider failure details and kept completed generation and tool errors visibly
distinct in chat. Consolidated optional-field construction behind one nullish-only helper and
documented that guardrail (`convex/scout/generation.ts`, `src/components/scout-run-message.tsx`,
`shared/omitNullish.ts`, `AGENTS.md`).

### 2026-09-04 - 2321fef - v167

Gave each Scout bounded outbound email through its own AgentMail inbox. Model and Manual runs can
send new messages and reply; registration verifies the provider inbox identity, and every write is
bounded and idempotent across transport and manual-action retries. Human-help email uses the same
inbox with Scout-authored context while durable jobs retain only the link digest. The 276-test gate,
production build, development deploy, and a live AgentMail send all passed (`convex/scout/`,
`src/routes/`, `EMAIL_SETUP.md`).

### 2026-09-04 - 611eb23 - v168

Made long Scout turns durable across bounded model slices, compacted old browser observations, and
captured each model call's exact input, usage, and cost. Added cached browser-session connections,
Firecrawl map and crawl tools, and a chat-first inspection UI that keeps session and call selection
in the URL (`convex/scout/`, `src/components/scout-model-input.tsx`, `src/routes/chats.tsx`).

Added Stop-and-send so a user can replace active work while Scout safely closes browser and handoff
state. Reduced human help to one visible-blocker reason while the server owns the email and private
link. The complete project check passes all 329 tests (`convex/humanHandoffs.ts`,
`convex/scout/humanHandoffTool.ts`, `convex/scout/turns.ts`).

### 2026-09-04 - 3cb697d - v169

Added persisted running summaries that compact older history at a token threshold while keeping
recent messages, complete tool exchanges, and the original transcript. The Model calls inspector
shows summary coverage, token estimates, and cost (`convex/scout/compactionContext.ts`,
`src/components/scout-model-input.tsx`). Scouts can prepare signup passwords through the existing
encrypted store and are instructed to record accounts immediately after authentication
(`convex/scout/accountTools.ts`, `convex/scout/runtimeInstructions.ts`).

### 2026-09-05 - b4dd421 - v170

Added click rings and browser-side MP4 export to the admin chat replay. Convex retains bounded
click events alongside browser operations, including failures, while MediaBunny renders the
recorded video and rings in a cancellable worker (`convex/scout/browserClickRecorder.ts`,
`src/components/browser-replay.tsx`, `src/lib/renderBrowserReplay.ts`).

### 2026-09-05 - 9f8ae55 - v171

Browser handoffs preserve the active browser across interrupted turns and send the private link
through the existing email workflow (`convex/scout/turns.ts`, `convex/humanHandoffs.ts`). Scout
profiles can save chosen passwords and account connections such as "Sign in with GitHub," while
login edits keep account links intact and require fresh authentication evidence
(`src/components/scout-service-accounts.tsx`, `convex/scout/serviceAccounts.ts`). Scout creation
explains missing email configuration (`convex/scout/scoutRegistration.ts`).

### 2026-09-05 - f97f1c1 - v172

Allowed longer Scout sessions to export with their click rings, up to 50 minutes.
The browser keeps the existing cancellable MP4 workflow with a 1 GiB output ceiling
(`src/lib/browserReplayExportPlan.ts`, `src/components/browser-replay-export.tsx`).

### 2026-09-05 - 5d4833d - v173

Node actions read current deployment configuration when Convex reuses a process (`convex/runtimeEnv.ts`).
Browser snapshots preserve iframe controls without internal references, and tool instructions explain
public helpers and bounded waits (`convex/scout/playwrightBrowser.ts`, `convex/scout/browserToolContract.ts`).
Inbox reads use minimal inputs and omit empty pagination values (`convex/scout/browserTools.ts`).
Resumed browsers restore password masking; password edits wait for browser closure (`convex/scout/accountTools.ts`, `convex/scout/serviceAccounts.ts`).
Account recording explains mismatches between visible names and saved login identifiers (`convex/scout/serviceAccounts.ts`).

### 2026-09-05 - ffbab14 - v174

Added optional games, research, and email guides that Scout selects through `load_skills`.
Active guidance stays separate from conversation summaries and survives compaction and later turns,
with follow-ups retaining their guides automatically. Selections and full instructions are visible
in Model calls (`convex/scout/skills.ts`,
`convex/scout/chats.ts`, `convex/scout/generation.ts`).

### 2026-09-05 - 0799f08 - v175

Enabled DeepSeek V4 Flash in the existing Scout chat flow through Convex AI Gateway.
Existing conversations can select it for later turns, with the choice retained in turn history
(`convex/scout/models.ts`, `src/routes/chats.tsx`, `src/components/scout-run-message.tsx`).

### 2026-09-06 - 57946c7 - v176

Added a "Managed with Samebase" credit below sign-in and in the chat navigation footer.
The embedded mark stays visible in light and dark themes
(`src/components/samebase-attribution.tsx`, `src/routes/chats.tsx`).

### 2026-09-06 - ee022cf - v177

Added a Scout overview and separate Play and Review identities (`src/products/`). Play invites
existing Scouts through Convex and shows the browser, conversation, help requests, and stop control.
Review has its own landing page and a link to the existing Lab while its dedicated flow is still being designed.
Tailwind utilities and shared class variants keep the product styling alongside its components.

### 2026-09-06 - 1947f45 - v178

Scout records successful signup and login using its saved account identifier, without searching
for exact email text or logout controls. Each report links to its browser operation while account,
service, and Scout checks retain the existing credential bindings
(`convex/scout/serviceAccounts.ts`, `convex/scout/accountTools.ts`).

### 2026-09-06 - 3ad2a63 - v179

Scout can fill unlabeled password fields through a CSS target while retaining the saved-host
and password-field checks. Browser guidance allows DOM inspection when labels are insufficient,
and handoff guidance covers actions the user needs to perform without requiring a visible challenge
(`convex/scout/browserTarget.ts`, `convex/scout/humanHandoffTool.ts`).

### 2026-09-06 - 41ff7c4 - v180

Matched the embedded Samebase mark to its text and aligned the credit to the sign-in and navigation
content edges (`src/components/samebase-attribution.tsx`, `src/routes/chats.tsx`).

### 2026-09-06 - 77d21bf - v181

Horizontal scrolling from the conversation can reach both sidebars. Removed message rendering
containment and bubble clipping so chat text uses normal browser selection and layout
(`src/components/ui/message-scroller.tsx`, `src/components/ui/bubble.tsx`).

### 2026-09-06 - 0dc91a9 - v182

Added member/admin roles and public signup with admin approval required for access.
Members controls audit approval and role changes, protect the last approved admin, and stop revoked
Lab work (`convex/accounts.ts`, `convex/functions.ts`, `convex/accountRevocation.ts`).
Pending accounts update when approved; Scout allocation remains open in `docs/access-control-rfc.md`.
Preview deploys configure their auth origin; code checks and resend limits protect verification emails.
Shared Scout activity hides other accounts' chat details.

### 2026-09-06 - fdbb989 - v183

Simplified access to optional `users.isApproved` and Samebase's email-derived staff permissions.
Members now manages approval only; approved members can enter Play/Review while existing Scout
execution stays in the admin Lab (`convex/schema.ts`, `convex/accounts.ts`). Restored the v181
Cloudflare deployment script.

### 2026-09-07 - 5f5219e - v184

Restored the intended Scout administrator email in the derived staff permissions.
The replaced address follows ordinary account approval (`convex/access.ts`).

### 2026-09-07 - 12e31e3 - v185

Added self-service account deletion from Settings, with typed confirmation and manual retry after failure.
The existing Convex Workflow removes profile and login data while retaining a deleted user stub,
chats, messages, files, and shared Scouts (`convex/accountDeletion.ts`, `src/routes/account-deletion.tsx`).

### 2026-09-07 - 1e05dca - v186

Play starts with a message and keeps Scout’s commentary beside its browser in a resizable sidebar.
The same panel opens by swipe on mobile and includes replay, download, and browser session selection.
The agent can save its current activity on the chat; existing turns still own stopping and handoffs.
Full transcripts remain in Lab (`src/products/play/page.tsx`, `convex/scout/play.ts`).
Worktree development uses a separate cloud deployment so model calls can reach Convex AI Gateway.

### 2026-09-07 - f747748 - v187

Added private per-chat Bash workspaces with file browsing, verified previews/downloads, and a terminal.
Plain TypeScript runs through QuickJS with bounded virtual files; Convex keeps metadata and R2 stores
bytes under deployment/user/chat/file paths. Development/preview and separate production storage are connected.
Web reads save complete Markdown sources for later searches and return short excerpts.
Views, files, replays, sessions, account forms, and chat panes support URL bookmarks and Back/Forward.
Workspace saves recheck current access (`convex/scout/`, `src/routes/`, `src/components/`).

### 2026-09-07 - 6fc3f70 - v188

Web and email reads always save complete results in the private chat workspace, while model
context receives full previews for small results and excerpts for large ones. MCP email payloads are unpacked for direct JSON queries.
Unchanged Bash reads no longer contend for a saved revision (`convex/scout/toolResults.ts`,
`convex/scout/workspaceTools.ts`).

### 2026-09-07 - f280fbd - v189

R2 uploads now group by workspace file path before the upload ID, making files easier to browse
in the bucket while retaining the existing save and cleanup behavior (`convex/workspaceStorage.ts`).

### 2026-09-08 - f22f91c - v190

Web reads can save Markdown, cleaned HTML, or raw HTML for later inspection in the chat workspace.
Bash can also select a shared site workspace by hostname, reusing saved files across Scouts and
chats. The Sites pages expose those files and a terminal independently of chat. Live trials
confirmed explicit sharing and reading, while autonomous discovery and guide
accuracy still failed (`convex/scout/workspaceTools.ts`, `docs/shared-site-workspace-trial-2026-09-08.md`).

### 2026-09-08 - d9288f3 - v191

Shortened Scout's general and game instructions. Play now explicitly requests shared-site
preparation and continuing through an observed game result; preparation remains model-driven.
Restored native browser selection highlighting so selected chat text is visible
(`convex/scout/play.ts`, `convex/scout/skills.ts`, `src/style.css`).

### 2026-09-10 - 07f0442 - v192

Made runtime prompts and tool guidance easier to inspect and edit as indented sections,
while preserving inserted identities, guides, and summaries. Workspace guidance now uses
the same limits as execution (`convex/scout/runtimeInstructions.ts`, `convex/workspaceModel.ts`).

### 2026-09-10 - 9d8cf9c - v193

Required patched YAML parsing and Hono dependencies across the TanStack and Convex dependency
trees to clear the production supply-chain gate (`pnpm-workspace.yaml`).

### 2026-09-10 - 2205c16 - v194

Added a Luna reasoning-effort picker to Lab, from None through Max with a provider-default option.
Convex retains the selection for each turn, subsequent model steps, replacements, and resumed handoffs.
Run details show the chosen effort and reasoning-token usage for comparisons
(`src/routes/chats.tsx`, `convex/scout/generation.ts`, `src/components/scout-run-message.tsx`).

### 2026-09-10 - edd94ce - v195

Chat Lab defaults to Luna with Max effort and remembers each chat's choice across refreshes and sign-ins.
Picker changes also set the account's default for new chats, while existing chats keep their own choice.
Earlier chats recover their selection from the latest run, and Manual remains temporary
(`convex/scout/chats.ts`, `convex/schema.ts`, `src/routes/chats.tsx`).

### 2026-09-10 - f3ffc49 - v196

Added public and private chats with one paginated homepage feed for Play and Review.
Both products share a conversation interface, guest viewing, and live browser or replay,
with distinct styling and a shared navigation menu. Approved members run their own chats
through the existing harness. A Review trial completed; a game trial still stopped early
(`convex/scout/activity.ts`, `src/products/conversation/`).

### 2026-09-10 - cc66910 - v200

Restored public web tools to the Firecrawl SDK and removed the Firecrawl and AgentMail component
registrations and dependencies. Mail tools and handoff delivery continue through Scout's existing
API client and workflow (`convex/scout/webTools.ts`, `convex/convex.config.ts`).

### 2026-09-10 - 454cb7f - v202

Ran product-review trials with Luna Max and recorded where the agent verified behavior,
stopped too early, or mishandled a blocker. Background blank tabs no longer appear in
the model's tab list (`convex/scout/browserToolContract.ts`, `docs/review-trials-2026-09-10.md`).

### 2026-09-11 - 1e91237 - v203

Browser snapshots and later actions follow the explicitly selected tab, including after
reconnecting. Convex retains the browser target ID on each session. A live Review
verified tab switching and todo persistence (`convex/scout/browserTools.ts`,
`convex/scout/browserSessions.ts`).

### 2026-09-12 - fe13de6

Added `/agents`, a Lab experiment using OpenAI's managed Agents API with Luna at
maximum reasoning effort. It runs alongside the existing Play, Review, and Chat Lab
so we can compare the two approaches using the same Scouts. OpenAI manages the model
loop and conversation context; Convex Workflow coordinates requests and executes
Scout's browser, email, and account tools.

The experiment reuses Scout identities, inboxes, encrypted credentials, connected
accounts, and Firecrawl browser profiles. Convex persists sessions, transcripts, and
function results, and reserves each Scout across both runtimes. Conversations support
follow-ups, Stop, and human browser handoff with Resume. Browser connections are
released after tool execution, while completed sessions retain their recordings.

The new interface reuses Samebase sidebars and the Lab's message and replay components.
It shows streamed assistant messages, reasoning summaries, and tool activity, plus
live browser access and recorded sessions. Replay includes tab selection, seeking,
click overlays, and MP4 export. Usage shows estimated model and search cost, cached
input tokens, and Firecrawl credits. Stopping a run preserves its transcript and
recordings; refreshing retrieves provider history without restarting the agent.

Development trials used the ordinary request to create a disposable Samebase app and
check its deployment. Scout created the app, then verified that an added and completed
todo survived a reload. Other trials read a real Scout inbox, resumed a browser handoff,
and opened a second browser while keeping the first recording available. A Score Four
review exercised live messages and tools, Stop, and a completed follow-up covering
local play and the online waiting room.

This remains an experiment: it does not yet include the existing harness's shared site
workspaces or Scout credit billing, and these trials do not establish which runtime
performs better. The live browser embed worked in Chrome; the Codex in-app browser
still showed a blank cross-origin embed even though the standalone viewer worked
(`convex/agentsApi/`, `src/agents-api/`).

### 2026-09-12 - d9b6acc

Review now uses the OpenAI Agents API from its existing member-facing page, with shared
public activity, private conversations, handoff controls and email, and live browser/replay.
Play and earlier conversations keep their original runtime. A member’s Score Four review
verified local gameplay, undo, win detection, and room creation; signed-out viewers could
watch the live browser and play the completed recording.

### 2026-09-12 - 3e44525

Moved Scout's frontend, Convex backend, and app scripts into `apps/scout/` in a pnpm
workspace. Vite+ runs the existing root development, check, and deployment commands.
Other apps and shared packages can now be developed alongside Scout; video processing
will be a separate change. The primary checkout still uses its existing Convex dev deployment.

### 2026-09-12 - 0973d9f

Replays now show browser-style tabs and a selectable address bar above the video.
The address follows saved URL observations when seeking forward or backward;
tab selection and automatic following use the existing replay controls.
The shared header works in the Agents, Lab, Play, and Review interfaces
(`apps/scout/src/components/browser-replay-header.tsx`).

### 2026-09-14 - be98e37

Admins can inspect member-created Reviews in Agents, including their transcripts,
cost, live view, and replay. The session list now loads older conversations, and
Review links to its inspector for admins. Sending messages and controlling a run
remain with its owner (`apps/scout/convex/agentsApi/`, `apps/scout/src/agents-api/`).

### 2026-09-14 - 27e5cfb

Members can browse Scout profiles and email addresses while account management stays admin-only.
Settings identifies the signed-in account. Activity filters use shadcn dropdowns, with yellow Play
and emerald Review badges. The shared navigation keeps stable typography across product themes
(`apps/scout/convex/scout/scouts.ts`, `apps/scout/src/components/`, `apps/scout/src/style.css`).

### 2026-09-14 - e1a68a0

The homepage now starts reviews and lists previous ones, with site and public/my filters.
Reviews store their primary hostname in Convex; Scout can identify it and the owner can correct it.
Site links open the filtered list, independent of browser navigation and shared workspaces
(`apps/scout/convex/scout/reviewSites.ts`, `apps/scout/src/components/activity-feed.tsx`).

### 2026-09-14 - 6f0262c

Review rows use smaller previews and a separate site column. New Agents API sessions can use
the existing Bash workspace to keep private files and share research through site workspaces.
Convex scopes private files to their session; admins can inspect them in the Agents workspace view
(`apps/scout/convex/scout/workspaces.ts`, `apps/scout/src/agents-api/page.tsx`).

### 2026-09-14 - 4f4a7fe

New Agents sessions get a short title and a request check before the main agent starts.
Convex stores the decision and call details; declined requests stay out of public results.
Admins inspect Request check and Chat in an always-open tree that stays mounted during navigation,
with the call's timing, estimated cost, input, and response. Review conversations use padded chat
panels and a separate replay with a compact resize grip
(`apps/scout/convex/agentsApi/requestCheck.ts`, `apps/scout/src/agents-api/page.tsx`).

### 2026-09-14 - 8aad831

Scout profiles and the picker now share availability and identify the task reserving each Scout,
with activity previews below its details and private work visible only to its owner and admins.
Returning browser control runs a fresh page check before continuing the same agent conversation.
Convex retains each attempt for inspection; rejection keeps the handoff paused, and Stop blocks
late approvals. The admin tree keeps one Chat beside the request and resume checks
(`apps/scout/convex/agentsApi/requestChecks.ts`, `apps/scout/src/agents-api/page.tsx`).

### 2026-09-15 - bdf25f2

Reviews gather public site information with a bounded Firecrawl Agent job before browser work.
The existing Convex workflow handles polling and cancellation; each task retains its briefing
and provider request/result in R2, while the site workspace holds the latest public brief.
Admins inspect research beside Chat, with timing and reported credits; the task workspace stays
available from every step
(`apps/scout/convex/agentsApi/siteResearch.ts`, `apps/scout/src/agents-api/site-research.tsx`).

### 2026-09-15 - dc8b381

Scout can save screenshots during a review and assemble them into an illustrated walkthrough.
Convex records each capture's task, page, timing, and note; original PNGs stay in the existing
R2 bucket and follow the task's public/private access. Review and Agents share a viewer with
explanations, Previous/Next, and Expand, while Chat, Replay, and Workspace remain available
(`apps/scout/convex/agentsApi/walkthrough.ts`, `apps/scout/src/components/task-walkthrough.tsx`).

### 2026-09-16 - 817ddbf

The landing page groups reviews beside a large site screenshot, keeps the composer, and
expands older reviews inline. New walkthroughs save passed, failed, or untested checks with
explanations; interrupted tasks keep their status beside any saved results. Public reads require
an approved request check, and the feed uses bounded pagination over existing site indexes.
OpenAI HTTP requests now allow three retries for transient failures
(`apps/scout/convex/scout/activity.ts`, `apps/scout/convex/agentsApi/client.ts`).

### 2026-09-16 - 33b2fdf

Sites now connect the browsing experience: start with a site on the homepage, open its task list,
then inspect a review. The homepage keeps the task composer and loads more sites as you scroll,
with two task previews per card. A link shows the task count and opens the full list. Counts follow
the Public/My filter, and the directory and site sidebar share the same ordering. Convex stores
site membership and counts alongside task changes so browsing can paginate sites without loading
the entire task history (`apps/scout/convex/scout/sites.ts`).

Each site owns its name, homepage URL, and landing screenshot. Firecrawl captures the public
homepage separately from a Scout's logged-in browser, and the image lives in the existing R2
bucket. This gives the directory and sidebar a consistent preview independent of any review's
walkthrough. Cards show the site name and domain, or just the domain when no name is available;
the screenshot fills its panel (`apps/scout/convex/scout/sitePreviews.ts`).

Site research is shared too. Tasks reuse completed Firecrawl research or wait for the same running
job. The site workspace holds the request, result, and latest brief; each task receives its own
copy of the brief in its workspace and records which research it used. Admins can inspect the
workspace beside the site's task list and explicitly refresh research. A refresh does not change
the brief retained by earlier tasks (`apps/scout/convex/agentsApi/siteResearch.ts`).

Inside a review, the left sidebar lists other tasks for that site. Switching tasks keeps the
navigation, pane widths, and sidebar scroll position while the selected content loads. The title
and view tabs span the main area: Walkthrough pairs explanations with screenshots, while
Chat & replay pairs the conversation with its recording. Interruption notices sit inside the chat
(`apps/scout/src/products/conversation/page.tsx`).

### 2026-09-17 - 744ccf8

Member chats, Lab, and Agents share compact tool rows with paired results, links, and saved
screenshots. Failures and interruptions remain visible. Convex checks chat access and redacts
member tool details (`apps/scout/convex/scout/activity.ts`). Site pages show a short description
from the existing Firecrawl research job (`apps/scout/convex/agentsApi/siteResearch.ts`).
Directory screenshots keep a 16:10 ratio as cards shrink, with two-line task summaries and
stacked cards below 640px. Site workspaces use the available pane height.

### 2026-09-17 - v219 - 48acef5

The homepage opens with an animated discovery field and a new headline above the existing
review composer and site list. TypeGPU draws green and amber contours on the page background,
extending behind the composer and fading out below it. Motion pauses while typing or offscreen
and respects reduced motion. A static field keeps the same treatment without WebGPU
(`apps/scout/src/components/discovery-hero.tsx`).

### 2026-09-17 - v220 - working tree

Site search and Public/My reviews now stay in the URL across the homepage, site pages, and tasks.
The site sidebar has the same controls, so filters remain editable while browsing. Partial site
names and domains update results after a short pause in typing, without filling browser history.
Convex matches within bounded pages and retains visibility rules and ordering. The sites sidebar
can still shrink, with its maximum width capped at 368px
(`apps/scout/src/components/site-filters.tsx`, `apps/scout/convex/scout/sites.ts`).
