# Local setup

Use this when you want to run the app from your own computer instead of only
through Cloudflare.

## Install Vite+

On macOS or Linux:

```sh
curl -fsSL https://vite.plus | bash
```

On Windows PowerShell:

```powershell
irm https://vite.plus/ps1 | iex
```

Open a new terminal after installing Vite+. Enable the package-manager shims, then install
dependencies:

```sh
corepack enable
pnpm install
```

## Run the app

The app lives in `apps/scout/`. Its `.env.local` and other app environment files belong there.
When updating a checkout from the previous layout, move its root `.env.local` into `apps/scout/`.

From the repository root:

```sh
pnpm run dev
```

`pnpm run dev` starts Convex and TanStack Start together. On the first run,
Convex may ask you to sign in and choose or create a development deployment.
The dev script also creates Convex Auth JWT keys in that development deployment
if they are missing. Scout uses Convex AI Gateway, which requires a cloud backend;
anonymous and local backends cannot run its model calls.

For a linked Git worktree, create and select a separate cloud dev deployment once.
Replace the team, project, and feature below with your own values:

```sh
pnpm --filter samebase-scout exec convex deployment create <team>:<project>:dev/<feature> --type dev --select
pnpm run dev
```

New cloud dev deployments inherit the project's dev environment defaults. Sign up or sign in
normally; the launcher does not create an account or set a password. It refuses anonymous
deployments, deployment-key overrides, and the primary checkout's selected deployment.
The worktree startup command accepts no extra arguments. Use the Convex CLI separately to
configure deployments. Changing deployments does not move chats, Scouts, or saved accounts.

The primary checkout reserves `http://localhost:5173` and stops if that port is occupied.
Linked worktrees start at port `5174` and try higher ports when needed. Open the local URL
printed by Vite.

## Reviewed-site totals

The landing page shows the total number of distinct sites in the selected review visibility.
The total includes sites beyond the loaded page and stays unchanged when searching by name.
Review changes update the public and account totals in the same transaction as the site listings.

After first deploying reviewed-site totals to an existing database, initialize them once:

```sh
pnpm --filter samebase-scout exec convex run scout/sites:recount
```

This targets the selected development deployment. Run it against any existing deployment when
rolling out the change, before serving the updated frontend. It can also repair the totals after
manual data edits. Recount is atomic, can be repeated, and rejects tables with more than 4,000 rows
instead of storing a partial total.

## Public handoff links

Human-help emails reuse Convex Auth's `SITE_URL` as the canonical app origin. Local development
normally sets it to `http://localhost:5173`, so emailed handoff links work when opened on the same
computer. To open them from another device, point `SITE_URL` at an HTTPS preview deployment or
tunnel that serves this frontend and connects to the same Convex deployment.

## Configure Scout integrations

Development and production have separate Scout registries and environment variables. A code
deployment does not copy development Scouts or credentials into production.

Set `AGENTMAIL_API_KEY` before registering a Scout. Registration verifies an existing AgentMail
inbox; it does not create one. Browser tasks also require `FIRECRAWL_API_KEY`.

Configure `AGENTMAIL_API_KEY`, `FIRECRAWL_API_KEY`, and `SCOUT_CREDENTIAL_MASTER_KEY_V1`
as project defaults for both **dev** and **preview** deployments. For example, omit the
value to enter it privately:

```sh
pnpm --filter samebase-scout exec convex env default set FIRECRAWL_API_KEY --type dev
pnpm --filter samebase-scout exec convex env default set FIRECRAWL_API_KEY --type preview
```

Convex applies defaults when creating a deployment; changing defaults does not update
existing deployments. Use deployment-specific commands for those:

```sh
pnpm --filter samebase-scout exec convex env set AGENTMAIL_API_KEY
pnpm --filter samebase-scout exec convex env set FIRECRAWL_API_KEY
```

These commands target development. Add `--prod` to configure production after confirming the
target deployment. Production also needs its own managed-credential key, described below, and
`SITE_URL` must point to the production frontend for sign-in and handoff emails.

## Configure managed credentials

Managed service-account registration requires one 32-byte master key in the Convex deployment.
Generate a canonical base64 value with Node.js:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

Set the printed value as the Convex environment variable
`SCOUT_CREDENTIAL_MASTER_KEY_V1`. Omit the value from the command and paste it at the interactive
prompt so it does not enter shell history:

```sh
pnpm --filter samebase-scout exec convex env set SCOUT_CREDENTIAL_MASTER_KEY_V1
```

Store the same value in a separate secured backup. Convex data backups do not include an
independent copy of this key. Do not replace the `_V1` value after creating credentials: key
fingerprint checks intentionally stop reads and writes rather than mixing two keys under one
version.

A Scout can prepare its own password for a new account with `prepare_account_password` on the
service's signup page. The tool saves an encrypted password for that scout and the exact HTTPS host;
`fill_account_password` loads it when called. The profile form remains available for manual setup.
Preparation does not prove the remote account exists: successful signup or login must be recorded
with `record_authenticated_service_account`. OAuth accounts refer to the exact provider account
belonging to the same scout.

## Worktree mode

Use the normal `pnpm run dev` command in a linked Git worktree. The explicit command
runs the same worktree checks and startup:

```sh
pnpm run dev:worktree
```

The context launcher selects `run-primary-dev.ts` or `run-worktree-dev.ts`.
Both modes use the same Windows-safe service launcher.
