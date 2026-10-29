# Deploy

Convex serves TrailScout next to its backend with
[`@samebase/convex-hosting`](https://github.com/samebase/convex-hosting). Production uses
`https://scout.samebase.com`; its original `https://doting-crab-687.convex.site` URL remains
available. Previews use `https://<deployment>.convex.site`. `pnpm run deploy` in `apps/scout/`
builds the app, uploads `dist/client` to the hosting component, and pushes the Convex functions.
The push switches the site. `convex/http.ts` answers a path without an uploaded file with the
TanStack Start server build.

The root `alchemy.run.ts` defines the `samebase/scout` stack. It selects the existing `scout`
project in the Convex team `nicu`. Production keeps its deployment, data, and signing keys.
The deployment command runs in `apps/scout` through `Convex.Deployment.rootDir`.

The production custom domain is attached to HTTP Actions in the Convex dashboard, with DNS in
Cloudflare. Those settings are managed outside the stack. Alchemy sets production `SITE_URL`
and the stack's public URL to `https://scout.samebase.com`. `CONVEX_SITE_URL` stays at
`https://doting-crab-687.convex.site`, and `CONVEX_CLOUD_URL` keeps its default backend URL.

`.github/workflows/alchemy.yml` runs the stack from the repository root:

- A push to `main` deploys stage `prod`. The stack adopts the existing production deployment
  and retains it when the stack is destroyed.
- A pull request from this repository deploys stage `pr-<number>`, with a Convex preview of the
  same name. The stack comments its URLs on the pull request. The preview command sets `SITE_URL`
  to the preview's site before the hosting deployment and seeds the development password account
  after it.
- Closing the pull request destroys its stage and deletes its preview. The existing Convex
  project and the preview comment are retained. Forks receive no preview credentials.

The repository secret `CONVEX_ACCESS_TOKEN` is a team access token for `nicu`, dedicated to this
repository. Alchemy creates temporary deployment keys for its commands. The former
`CONVEX_DEPLOY_KEY` and `CONVEX_PREVIEW_DEPLOY_KEY` repository secrets are no longer read by this
workflow.

The production job uses `CLOUDFLARE_ACCOUNT_ID` and the repository secret `CLOUDFLARE_API_TOKEN`
to manage the buckets and to mint production's email-sending token. That CI token,
`scout-alchemy`, needs its R2 permission and Account API Tokens Write. Pull request jobs
receive no Cloudflare token. Scout continues using its existing bucket-scoped S3 credentials in
Convex.

Stage `prod` mints the account API token `scout production email sending`, with only Email
Sending Write, and retains it when the stack is destroyed. See `EMAIL_SETUP.md`.

Google sign-in runs through the team's identity hub. Every run, a destroy too, reads the repository
variable `HUB_ISSUER` (`https://auth.samebase.com`) and the repository secret
`HUB_REGISTRATION_TOKEN`, the hub's registration token for the app TrailScout, and stops before the
stack when either is empty. The stack registers one hub client per deployment, on its Convex
site URL plus `/auth/hub/callback`, writes `HUB_ISSUER`, `HUB_CLIENT_ID`, and `HUB_CLIENT_SECRET` to the
deployment before its push, and deletes a preview's client with the preview. Production keeps
`https://doting-crab-687.convex.site/auth/hub/callback` as the hub callback. Convex Auth accepts
the new public origin through `SITE_URL` and returns the browser there after sign-in.

Each stage has one queue shared by deployment and cleanup. Before deployment,
`scripts/verify-deployment-head.ts` checks that the checkout is still the head of the branch.
GitHub CI runs `pnpm run check` separately. Deployment does not repeat it.

The team's `alchemy-state` Convex project stores the stack state. Its `samebase.run` output
records the repository, stack file, branch, commit, pull request, and workflow run for Samebase's
repository overview. `SCOUT_COMMIT` is a deployment input so a change outside `apps/scout` also
deploys. Alchemy manages `SCOUT_COMMIT` and the three `HUB_` variables on each deployment, plus
`SITE_URL` and the two `CLOUDFLARE_EMAIL_` variables in production. Other deployment environment
variables remain unmanaged.

Stage `prod` also owns the existing R2 buckets `scout-workspaces-prod`, `scout-workspaces`, and
`scout-public-media`, so Samebase can show them with Scout's other resources. All three have a
retain policy. Preview stages keep using their existing Convex environment defaults and do not
own these shared buckets. R2 credentials, object keys, and the public-media cache rule stay as
configured.

The bucket declarations preserve the settings read from Cloudflare on October 22, 2026:
Standard storage, default jurisdiction, no CORS rules, disabled `r2.dev` access, and the existing
seven-day rule for aborting incomplete multipart uploads. They keep the public custom domain
`scout-media.samebase.com` enabled with minimum TLS 1.2. Existing locations and lock rules remain
unmanaged. Before changing these declarations, read the live settings: Alchemy's bucket plan does
not refresh CORS, lifecycle, or domain settings, but adoption reconciles them. Omitting CORS or
lifecycle rules clears them.

New development and preview deployments take the `DEV_SEED_AUTH_*` values from the project's
environment defaults. Production uses its managed `SITE_URL` for emailed sign-up and recovery links,
human handoff links, and payment return links.

Convex Auth signs sessions with `AUTH_PRIVATE_KEY` and serves `AUTH_JWKS` at
`/auth/.well-known/jwks.json`. `scripts/ensure-convex-auth.ts` creates the pair on a deployment
that has neither value, inside the build of `pnpm run deploy` and `pnpm run deploy:dev` and before
`pnpm run dev` starts `convex dev`, and keeps an existing pair. The keys of Convex Auth 0.0.x,
`JWT_PRIVATE_KEY` and `JWKS`, stay unused for a rollback.

## Local inspection

Use the Convex CLI login or set `CONVEX_ACCESS_TOKEN` for the intended team. Run Alchemy from the
repository root. Production plans also need a configured Alchemy Cloudflare profile, or
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the environment:

```sh
pnpm exec alchemy plan --stage prod --no-input
```

Inspect each stage's resource path, commit, and workflow run in
[Samebase's Alchemy view](https://samebase.com/repo/samebase/scout/alchemy).

Before removing a closed pull request's preview, inspect its cleanup plan. Replace `123` with
the pull request number:

```sh
pnpm exec alchemy destroy --stage pr-123 --dry-run --no-input
```

The plan deletes `Preview`, `HubClient`, and `Site` and orphans `Project` and `PreviewComment`.
Orphaned resources remain on their providers but leave the stage state during an actual destroy.
The dry run changes neither resources nor stage state. Keep previews for open pull requests.

Production deployment runs through GitHub Actions. Development keeps `pnpm run deploy:dev` and
the worktree's own selected cloud development deployment.

## First migration

Previews created by the previous workflow have branch-based names. They are outside the new
stack state. Check the corresponding pull requests before deleting those deployments; deleting
`pr-<number>` does not delete a branch-named preview.

Cleanup uses the stack on the base branch. If the first migration pull request closes without
merging, remove its preview with `pnpm exec alchemy destroy --stage pr-<number> --yes --no-input`
from the migration checkout, because the base branch does not yet have the stack.

## Rules

- Deploy with `pnpm run deploy` or `pnpm run deploy:dev`, never with a plain `convex deploy`. A
  plain push sends the site version of this checkout's last deploy, often another deployment's,
  and the site answers 404 until the next deploy.
- Do not deploy production from a development checkout. The deploy writes production's version to
  `apps/scout/.convex-hosting/version.js`, and a running `pnpm run dev` pushes it to the
  development deployment, whose site then answers 404 until the next `pnpm run deploy:dev`.

## URLs and caching

- `--html-handling drop-trailing-slash` serves the prerendered `about/index.html` at `/about`
  and redirects `/about/` and `/about/index.html` there. The same holds for `/privacy` and
  `/terms`.
- `apps/scout/public/_headers` caches the hashed files under `/assets/` for a year. Other files
  revalidate with an ETag. Rendered pages and 404 responses are `no-store`.
- The first request after a deploy deletes the previous version's files. A tab opened before the
  deploy reloads when `convex/siteVersion.ts` reports the new version; until then it gets 404 for a
  hashed file that the new version does not have.
