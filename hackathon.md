# Hackathon log

- **Project:** Scout
- **Event:** Convex All Gas Hackathon
- **What it does:** Will test web apps through fresh-user journeys and record whether their claims hold.
- **Live app:** https://usable-spider-599.eu-west-1.convex.site
- **Repo:** private
- **Frontend:** Convex static hosting
- **Convex deployment:** https://usable-spider-599.eu-west-1.convex.cloud
- **Components:** @convex-dev/static-hosting
- **Convex features:** schema, tables, indexes, queries, mutations, HTTP actions, realtime queries
- **Auth:** Convex Auth
- **AI models:** none
- **Started:** 2026-08-26T16:12:42Z
- **Last updated:** 2026-08-26T19:25:59Z

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

### 2026-08-26 - working tree

Shared one prerender route map between Cloudflare and Convex Static Hosting. Added a local
`rewritePath` patch so exact public routes serve their prerendered HTML while unknown routes keep
the SPA fallback (`prerender.config.ts`, `convex/http.ts`, `patches/`).
