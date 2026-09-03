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

From the repository root:

```sh
pnpm run dev
```

`pnpm run dev` starts Convex and TanStack Start together. On the first run,
Convex may ask you to sign in and choose or create a development deployment.
The dev script also creates Convex Auth JWT keys in that development deployment
if they are missing. In a linked Git worktree, it automatically uses an isolated
local backend.

Open the local URL printed by Vite.

## Public handoff links

Human-help emails reuse Convex Auth's `SITE_URL` as the canonical app origin. Local development
normally sets it to `http://localhost:5173`, so emailed handoff links work when opened on the same
computer. To open them from another device, point `SITE_URL` at an HTTPS preview deployment or
tunnel that serves this frontend and connects to the same Convex deployment.

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
pnpm exec convex env set SCOUT_CREDENTIAL_MASTER_KEY_V1
```

Store the same value in a separate secured backup. Convex data backups do not include an
independent copy of this key. Do not replace the `_V1` value after creating credentials: key
fingerprint checks intentionally stop reads and writes rather than mixing two keys under one
version.

Before asking a Scout to create or recover a password-based account, open its profile and register
the managed account. Set the exact host where the password form appears. The password tool selects
only that Scout's credential for the current HTTPS host. OAuth accounts instead refer to the exact
provider account belonging to the same Scout; neither login method requires a Product or Task.

## Force worktree mode

Use the normal `pnpm run dev` command in a linked Git worktree. Use the explicit
worktree command to force an isolated local backend in another checkout.

```sh
pnpm run dev:worktree
```

The context launcher selects `run-primary-dev.ts` or `run-worktree-dev.ts`.
Both modes use the same Windows-safe service launcher. The three launcher files
carry one shared content hash in their first line, and `pnpm run check` verifies
that hash.
