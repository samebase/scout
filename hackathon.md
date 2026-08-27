# Hackathon log

- **Project:** Scout
- **Event:** Convex All Gas Hackathon
- **What it does:** Will test web apps through fresh-user journeys and record whether their claims hold.
- **Live app:** https://usable-spider-599.eu-west-1.convex.site
- **Repo:** private
- **Frontend:** Convex static hosting
- **Convex deployment:** https://usable-spider-599.eu-west-1.convex.cloud
- **Components:** @convex-dev/static-hosting
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, realtime queries
- **Auth:** Convex Auth
- **AI models:** gpt-5.6-sol
- **Started:** 2026-08-26T16:12:42Z
- **Last updated:** 2026-08-27T00:46:16Z

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

### 2026-08-27 - working tree

Completed a profile-backed Tally benchmark and verified a published form submission. Added Bash
code fallback support, preserved safe provider diagnostics, distinguished replay links from live
views, and measured wall time across multiple fixed-lifetime browser sessions
(`convex/scout/browser.ts`, `convex/scout/runs.ts`, `convex/scout/lib/firecrawl.ts`).
