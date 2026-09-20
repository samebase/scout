# Scout

Explore Scout Play for browser games, Scout Review for testing products, and Agents
for inspecting tasks and comparing execution engines.

Live app: [doting-crab-687.convex.site](https://doting-crab-687.convex.site)

This pnpm workspace follows the Samebase monorepo layout. `apps/scout/` contains the current
frontend, Convex backend, and app scripts. New services go under `apps/`; shared libraries
go under `packages/` when needed. Vite+ provides the workspace task runner, checks, and tests.

For the complete provider setup, use the
[Samebase do-it-yourself guide](https://samebase.com/docs/do-it-yourself). This README covers work
inside the repository.

The [privacy policy](./apps/scout/src/content/privacy-policy.md) and
[terms and conditions](./apps/scout/src/content/terms-of-service.md) have an effective date
of September 19, 2026. The public `/privacy` and `/terms` routes render these Markdown files.
See [legal research](./docs/legal-research.md) for the sources, wording decisions, and ongoing
operational responsibilities.

## Stack

- React 19 and TanStack Start, with public-page SSR on Convex
- Convex for the real-time backend, database, and password authentication
- Cloudflare Workers Static Assets for production delivery and branch previews
- Convex HTTP actions for homepage HTML and Static Hosting for browser assets
- shadcn/ui primitives for the user interface
- Vite+ for development, formatting, linting, tests, and builds
- Node.js 24 for application and automation code

The public home page shows one activity feed with All, Play, and Review filters.
`/play` and `/review` use the same conversation interface, opening existing chats with `?thread=...`.
Approved members can start private or public chats with an available Scout; signup does not create
or assign Scouts. Guests can watch public conversations and live browsers or replays.
`/lab` provides one admin interface for tasks using OpenAI Agents API or the Convex Agent
component. Both share task checks, research, tools, walkthroughs, and replay. Member tasks use
Luna through Agents API by default. Members and admins can also select Luna through Convex,
Qwen 3.7 Flash, or DeepSeek V4 Flash when creating a task. See
[`docs/play-product-direction.md`](./docs/play-product-direction.md) for the product options and research.

Anyone can create an account and verify their email. `users.isApproved` is the only stored
access field and defaults to false. Admins come from the same email allowlist as Samebase;
other users need approval through `/members` or by editing `users.isApproved` in Convex.
The account model, permission boundaries, and rollout procedure are in
[`docs/access-control-rfc.md`](./docs/access-control-rfc.md), with the Samebase source findings in
[`docs/account-approval-research.md`](./docs/account-approval-research.md).

Product pages live in `apps/scout/src/products/`; the admin task interface lives in
`apps/scout/src/tasks/`, backed by the shared pipeline in `apps/scout/convex/tasks/`.
Tailwind utilities style the UI, with shared class variants in `apps/scout/src/products/ui.ts`.
Font declarations and Tailwind theme tokens live in `apps/scout/src/style.css`. Each product keeps its own
identity; separate frontends would still need their own routing and deployment setup.

Scout provides private chats with persistent Scout identities. A chat can use the Scout's
AgentMail inbox to read, send, and reply to email, plus its Firecrawl browser profile and accounts
across multiple services. Inspect tool calls, live browsers, replay, usage, and human handoffs
in the same task interface.

Settings sells credit packs through Polar. See [credit packs and rollout](./docs/credits.md)
for pricing, discounts, refunds, and the required dashboard setup.

Each task also has a [Bash workspace](./docs/workspaces.md) with a file tree, text preview, and downloads.
The agent can run JavaScript and TypeScript with `js-exec`, using standard APIs and no npm.
The agent shares those files with the user. It runs inside Convex with file bytes in
private Cloudflare R2 storage. Development and Preview defaults are configured; existing or
isolated deployments need the [four R2 environment variables](./docs/workspaces.md#connect-r2).

Views are URL-backed: chat and browser-session selection, recorded tabs, workspace files,
new-chat and registration panels, and chat-pane visibility support Back, Forward, and bookmarks.
Drafts, form contents, pane widths, and replay playback time remain local.

## Local development

Install [Vite+](https://viteplus.dev/guide/) and use it to supply the Node.js version in
`.node-version`. Run `corepack enable` once to make the pinned pnpm version available.

```sh
corepack enable
pnpm install
```

Before the first build, select a cloud development deployment so Convex writes
the app's URL to `apps/scout/.env.local`, then start development:

```sh
pnpm --filter samebase-scout exec convex deployment select <development-deployment>
pnpm run dev
```

Run these commands from the repository root. Development starts Convex and TanStack Start
together, using port 5173 for the primary checkout and ports starting at 5174 for linked worktrees.
It first builds the server imported by Convex's homepage HTTP action. Rebuild with
`pnpm run build:app` to update that hosted renderer after frontend changes; local Vite
development keeps its usual hot reload.
Worktrees must select their own cloud dev deployment. Convex writes its selected deployment and
`VITE_CONVEX_URL` to `apps/scout/.env.local`. Move an existing root `.env.local` there when
updating an older checkout.

To run the worktree deployment checks explicitly, use:

```sh
pnpm run dev:worktree
```

The core workflow runs on macOS, Linux, and Windows. See
[`docs/local-setup.md`](./docs/local-setup.md) for the local Convex setup and troubleshooting steps.

For app-specific CLIs, use `pnpm --filter samebase-scout exec <command>`, for example
`pnpm --filter samebase-scout exec convex dashboard`. New workspace packages should define a
`typecheck` script and a Vite+ test configuration when they have tests. Root checks include
workspace typechecks and tests; root build/deploy commands target Scout.

## Checks and builds

| Command                           | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `pnpm run check`                  | Format, lint, type-check, and test                   |
| `pnpm run build`                  | Build for Cloudflare without rerunning checks        |
| `pnpm run deploy:convex`          | Build and deploy the production app to `convex.site` |
| `pnpm run deploy:dry-run`         | Validate a production upload without publishing it   |
| `pnpm run deploy:preview:dry-run` | Validate a preview upload without publishing it      |

The dry-run commands need `CLOUDFLARE_WORKER_NAME`.

On macOS or Linux:

```sh
export CLOUDFLARE_WORKER_NAME=my-worker
```

On Windows PowerShell:

```powershell
$env:CLOUDFLARE_WORKER_NAME = "my-worker"
```

## Deployment contract

Cloudflare Workers Builds keeps its root directory at the repository root and runs
`pnpm run build` for all branches. Root commands select `samebase-scout` through Vite+; app
commands run with `apps/scout/` as their working directory. GitHub CI runs `pnpm run check`
separately; the Workers build only builds and deploys. It then uses:

| Branch type             | Deploy command            | Convex key                  |
| ----------------------- | ------------------------- | --------------------------- |
| `main`                  | `pnpm run deploy`         | `CONVEX_DEPLOY_KEY`         |
| Non-production branches | `pnpm run deploy:preview` | `PREVIEW_CONVEX_DEPLOY_KEY` |

`apps/scout/scripts/build-cloudflare.ts` selects the Convex key from `WORKERS_CI_BRANCH` and fails closed when
the branch identity is missing. `apps/scout/scripts/verify-current-branch-head.ts` prevents an older concurrent
build from deploying backend code after a newer commit reaches the same branch. `convex deploy
--cmd` supplies `VITE_CONVEX_URL` to the frontend build, so it is not a Cloudflare build variable.
Set each Convex preview's `SITE_URL` to its frontend origin for signup verification and handoff links.

`pnpm run deploy:convex` provides a separate manual production deployment to Convex Static Hosting.
For an automatic `main` deployment, the Cloudflare deploy command publishes the Worker first, then
uploads the same `apps/scout/dist/client` files to Convex Static Hosting. Preview and dry-run deployments do
not change the production `convex.site` app.

Preview builds also upload browser assets to the matching Convex preview. On
`convex.site`, the homepage and public site pages render their initial data into HTML.
The router uses the official Convex TanStack Query adapter and TanStack SSR query
integration. Ordinary queries use `useSuspenseQuery(convexQuery(...))`; paginated
lists use the shared `useSsrPaginatedQuery` bridge while native Convex hooks retain
live pagination. New public routes inherit SSR without a separate server loader.
Account, workspace, and personal views remain client-rendered.
`TANSTACK_SERVER_ENABLED=false` still restores static prerenders and the SPA shell.
See [Scout SSR verification](./docs/convex-ssr-experiment.md) for the PR preview
and commands to reproduce it without a Cloudflare runtime.

See [`docs/cloudflare-workers-builds.md`](./docs/cloudflare-workers-builds.md) for the detailed build
and deploy behavior. Use the
[do-it-yourself guide](https://samebase.com/docs/do-it-yourself) for the provider dashboard setup.

## Important files

- `package.json` defines the supported development, check, build, and deploy commands.
- `vite.config.ts` defines workspace formatting, lint rules, staged checks, and test projects.
- `apps/scout/vite.config.ts` prerenders the homepage, About, Privacy, and Terms, plus a separate
  SPA fallback shell. `apps/scout/prerender.config.ts` maps public URLs to their generated HTML;
  Cloudflare uses build-generated `_redirects`, and Convex uses the same exact path rewrites.
- `apps/scout/wrangler.jsonc` defines Cloudflare static assets, SPA fallback, and preview URLs.
- `apps/scout/scripts/build-cloudflare.ts` owns the Cloudflare build and Convex deployment selection.
- `apps/scout/scripts/deploy-cloudflare.ts` owns production, preview, and dry-run uploads.
- `docs/agent-runtime.md` describes Scout ownership, chats, tools, and handoffs.
- `apps/scout/convex/` contains the backend, schema, authentication, and generated Convex bindings.
- `apps/scout/src/` contains the React application and routes.

## Generated and managed files

- `apps/scout/src/routeTree.gen.ts` is generated by TanStack Router.
- `apps/scout/convex/_generated/api.*`, `dataModel.d.ts`, and `server.*` are generated by Convex.
- `apps/scout/convex/_generated/ai/`, `.agents/skills/`, `skills-lock.json`, and the marked Convex sections in
  `AGENTS.md` and `CLAUDE.md` are managed by `npx convex ai-files install`.
- The marked Vite+ section in `AGENTS.md` is managed by `vp config`.

Do not hand-edit generated files when their source tool can update them.
When a Convex AI-file update changes the installed source snapshot, confirm its distribution license
and update `THIRD_PARTY_NOTICES.md` when its third-party material changes.

## License

Licensed under the [Apache License 2.0](./LICENSE). See
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for included third-party material.
