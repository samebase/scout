# Scout

Explore Scout Play for browser games, Scout Review's product-review design preview, and the lab
for connected accounts and detailed agent work.

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

The public home page offers two product entries. `/play` introduces the game player, and
`/play/session` accepts a room link and opens a browser-and-chat session with an existing Scout.
`/review` is a landing page with its own visual identity and a static illustration. Its button opens
the existing Lab; the dedicated review flow is still to be designed.
`/chats` is the lab for detailed transcripts, replays, and model controls. See
[`docs/play-product-direction.md`](./docs/play-product-direction.md) for the product options and research.

Product pages and local behavior live in `src/products/play/` and `src/products/review/`.
Tailwind utilities and small class variants style the UI, with repeated elements in `src/products/ui.tsx`.
Font declarations and Tailwind theme tokens live in `src/style.css`. Each product keeps its own
identity; separate frontends would still need their own routing and deployment setup.

Scout provides private chats with persistent Scout identities. A chat can use the Scout's
AgentMail inbox to read, send, and reply to email, plus its Firecrawl browser profile and accounts
across multiple services. Choose Qwen, Luna, or Manual, and inspect tool calls, Live/Replay, usage,
and human handoffs in the same workspace.

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
automatically uses an isolated local backend and provides one-click access to its seeded development
account. Convex writes `VITE_CONVEX_URL` to `.env.local`; do not set it manually.

To force the isolated backend outside a linked worktree, use:

```sh
pnpm run dev:worktree
```

The core workflow runs on macOS, Linux, and Windows. See
[`docs/local-setup.md`](./docs/local-setup.md) for the local Convex setup and troubleshooting steps.

## Checks and builds

| Command                           | Purpose                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `pnpm run check`                  | Format, lint, type-check, test, and verify the dev launcher |
| `pnpm run build`                  | Run the complete Cloudflare build path                      |
| `pnpm run deploy:convex`          | Build and deploy the production app to `convex.site`        |
| `pnpm run deploy:dry-run`         | Validate a production upload without publishing it          |
| `pnpm run deploy:preview:dry-run` | Validate a preview upload without publishing it             |

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

Cloudflare Workers Builds runs `pnpm run build` for all branches. It then uses:

| Branch type             | Deploy command            | Convex key                  |
| ----------------------- | ------------------------- | --------------------------- |
| `main`                  | `pnpm run deploy`         | `CONVEX_DEPLOY_KEY`         |
| Non-production branches | `pnpm run deploy:preview` | `PREVIEW_CONVEX_DEPLOY_KEY` |

`scripts/build-cloudflare.ts` selects the Convex key from `WORKERS_CI_BRANCH` and fails closed when
the branch identity is missing. `scripts/verify-current-branch-head.ts` prevents an older concurrent
build from deploying backend code after a newer commit reaches the same branch. `convex deploy
--cmd` supplies `VITE_CONVEX_URL` to the frontend build, so it is not a Cloudflare build variable.

`pnpm run deploy:convex` provides a separate manual production deployment to Convex Static Hosting.
For an automatic `main` deployment, the Cloudflare deploy command publishes the Worker first, then
uploads the same `dist/client` files to Convex Static Hosting. Preview and dry-run deployments do
not change the production `convex.site` app.

See [`docs/cloudflare-workers-builds.md`](./docs/cloudflare-workers-builds.md) for the detailed build
and deploy behavior. Use the
[do-it-yourself guide](https://samebase.com/docs/do-it-yourself) for the provider dashboard setup.

## Important files

- `package.json` defines the supported development, check, build, and deploy commands.
- `vite.config.ts` defines the TanStack Start SPA shell served by both hosts.
- `wrangler.jsonc` defines Cloudflare static assets, SPA fallback, and preview URLs.
- `scripts/build-cloudflare.ts` owns the Cloudflare build and Convex deployment selection.
- `scripts/deploy-cloudflare.ts` owns production, preview, and dry-run uploads.
- `docs/agent-runtime.md` describes Scout ownership, chats, tools, and handoffs.
- `convex/` contains the backend, schema, authentication, and generated Convex bindings.
- `src/` contains the React application and routes.

## Generated and managed files

- `src/routeTree.gen.ts` is generated by TanStack Router.
- `convex/_generated/api.*`, `dataModel.d.ts`, and `server.*` are generated by Convex.
- `convex/_generated/ai/`, `.agents/skills/`, `skills-lock.json`, and the marked Convex sections in
  `AGENTS.md` and `CLAUDE.md` are managed by `npx convex ai-files install`.
- The marked Vite+ section in `AGENTS.md` is managed by `vp config`.

Do not hand-edit generated files when their source tool can update them.
When a Convex AI-file update changes the installed source snapshot, confirm its distribution license
and update `THIRD_PARTY_NOTICES.md` when its third-party material changes.

## License

Licensed under the [Apache License 2.0](./LICENSE). See
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for included third-party material.
