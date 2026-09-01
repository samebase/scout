# Scout

Test web apps through fresh-user journeys and record whether their claims hold.

Live app: [usable-spider-599.eu-west-1.convex.site](https://usable-spider-599.eu-west-1.convex.site)

This repository starts from the Samebase app template.

It is a small app base with working authentication, a real-time backend, and deployment paths.

For the complete provider setup, use the
[Samebase do-it-yourself guide](https://samebase.com/docs/do-it-yourself). This README covers work
inside the repository.

## Stack

- React 19 and TanStack Start in SPA mode
- Convex for the real-time backend, database, and password authentication
- Cloudflare Workers Static Assets for production delivery and branch previews
- Convex Static Hosting for the hackathon `convex.site` deployment
- shadcn/ui primitives for the user interface
- Vite+ for development, formatting, linting, tests, and builds
- Node.js 24 for application and automation code

Scout currently has an authenticated Product registry and an admin-only Lab for testing web apps.
An admin can collect sourced, explicitly unverified product claims, configure persistent Scout
identities, and start model threads that use each Scout's AgentMail inbox and Firecrawl profile.

## Local development

Install [Vite+](https://viteplus.dev/guide/) and use it to supply the Node.js version in
`.node-version`. Run `corepack enable` once to make the pinned pnpm version available.

```sh
corepack enable
pnpm install
pnpm run dev
```

The development command starts Convex and TanStack Start together. It also creates missing Convex
Auth JWT keys in the development deployment. In a linked Git worktree, the same command
automatically uses an isolated local backend. Convex writes `VITE_CONVEX_URL` to `.env.local`; do
not set it manually.

To force the isolated backend outside a linked worktree, use:

```sh
pnpm run dev:worktree
```

The core workflow runs on macOS, Linux, and Windows. See
[`docs/local-setup.md`](./docs/local-setup.md) for the local Convex setup and troubleshooting steps.

## Checks and builds

| Command                   | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `pnpm run check`          | Format, lint, type-check, test, and verify generated redirects |
| `pnpm run build`          | Build locally or run the complete Workers Builds build stage   |
| `pnpm run deploy`         | Deploy the production Worker and its hosted frontend           |
| `pnpm run deploy:preview` | Create or update the current branch's Worker Preview           |
| `pnpm run deploy:convex`  | Build and deploy the production app to `convex.site`           |
| `pnpm run deploy:dry-run` | Build and validate a production upload without publishing it   |

A local `pnpm run deploy:preview` needs `CLOUDFLARE_WORKER_NAME`.

On macOS or Linux:

```sh
export CLOUDFLARE_WORKER_NAME=my-worker
```

On Windows PowerShell:

```powershell
$env:CLOUDFLARE_WORKER_NAME = "my-worker"
```

## Deployment contract

Cloudflare Workers Builds runs `pnpm run build` for all branches. It then uses:

| Branch type             | Deploy command            | Convex key          |
| ----------------------- | ------------------------- | ------------------- |
| `main`                  | `pnpm run deploy`         | `CONVEX_DEPLOY_KEY` |
| Non-production branches | `pnpm run deploy:preview` | `CONVEX_DEPLOY_KEY` |

Use a production deploy key in **Settings > Builds > Production** and a project Preview deploy key
under the same name in **Settings > Builds > Previews Base**. `scripts/build-cloudflare.ts` uses the
key from the active trigger and fails closed when the branch identity is missing.
`scripts/verify-current-branch-head.ts` prevents an older concurrent build from deploying backend
code after a newer commit reaches the same branch. `convex deploy --cmd` supplies
`VITE_CONVEX_URL` to the frontend build, so it is not a Cloudflare build variable.

`pnpm run build`, `pnpm run deploy`, and `pnpm run deploy:preview` are the stable repository
interface. The scripts under those names can change without changing the Cloudflare configuration.
Outside Workers Builds, `pnpm run build` runs only the app build.

`pnpm run deploy:convex` provides a separate manual production deployment to Convex Static Hosting.
For an automatic `main` deployment, the Cloudflare deploy command publishes the Worker first, then
uploads the same `dist/client` files to Convex Static Hosting. Preview and dry-run deployments do
not change the production `convex.site` app.

See [`docs/cloudflare-workers-builds.md`](./docs/cloudflare-workers-builds.md) for the detailed build
and deploy behavior. Use the
[do-it-yourself guide](https://samebase.com/docs/do-it-yourself) for the provider dashboard setup.

## Important files

- `package.json` defines the supported development, check, build, and deploy commands.
- `prerender.config.ts` defines public prerenders and the exact aliases shared by both hosts.
- `vite.config.ts` defines the TanStack Start SPA and prerender behavior.
- `wrangler.jsonc` defines Cloudflare static assets, SPA fallback, and preview URLs.
- `scripts/build-cloudflare.ts` owns the Cloudflare build and Convex deployment selection.
- `scripts/deploy-production.ts` adds the production Convex Static Hosting upload after Wrangler.
- `scripts/deploy-worker-preview.ts` passes the connected Worker name to Worker Previews.
- `docs/agent-runtime.md` describes the current Scout, Lab thread, and generation model.
- `convex/` contains the backend, schema, authentication, and generated Convex bindings.
- `src/` contains the React application and routes.

## Generated and managed files

- `src/routeTree.gen.ts` is generated by TanStack Router.
- `convex/_generated/api.*`, `dataModel.d.ts`, and `server.*` are generated by Convex.
- `convex/_generated/ai/`, `.agents/skills/`, `skills-lock.json`, and the marked Convex sections in
  `AGENTS.md` and `CLAUDE.md` are managed by `npx convex ai-files install`.
- The marked Vite+ section in `AGENTS.md` is managed by `vp config`.
- `scripts/generate-cloudflare-redirects.ts` owns only the marked generated block in
  `public/_redirects`. Custom redirect rules can stay outside that block.
- `patches/@convex-dev__static-hosting@0.2.1.patch` adds the `rewritePath` hook used by
  `convex/http.ts`. Remove it when the package ships an equivalent API.

Do not hand-edit generated files when their source tool can update them.
When a Convex AI-file update changes the installed source snapshot, confirm its distribution license
and update `THIRD_PARTY_NOTICES.md` when its third-party material changes.

## License

Licensed under the [Apache License 2.0](./LICENSE). See
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for included third-party material.
