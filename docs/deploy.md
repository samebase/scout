# Deploy

Convex serves TrailScout next to its backend with
[`@samebase/convex-hosting`](https://github.com/samebase/convex-hosting), at
`https://<deployment>.convex.site`. `pnpm run deploy` in `apps/scout/` builds the app, uploads
`dist/client` to the hosting component, and pushes the Convex functions. The push switches the
site. `convex/http.ts` answers a path without an uploaded file with the TanStack Start server
build.

The root `alchemy.run.ts` defines the `samebase/scout` stack. It selects the existing `scout`
project in the Convex team `nicu`. Production keeps its deployment, data, signing keys, and URL.
The deployment command runs in `apps/scout` through `Convex.Deployment.rootDir`.

`.github/workflows/alchemy.yml` runs the stack from the repository root:

- A push to `main` deploys stage `prod`. The stack adopts the existing production deployment
  and retains it when the stack is destroyed.
- A pull request from this repository deploys stage `pr-<number>`, with a Convex preview of the
  same name. The stack comments its URLs on the pull request. The preview command sets `SITE_URL`
  and seeds the development password account after the hosting deployment.
- Closing the pull request destroys its stage and deletes its preview. The existing Convex
  project and the preview comment are retained. Forks receive no preview credentials.

The repository secret `CONVEX_ACCESS_TOKEN` is a team access token for `nicu`, dedicated to this
repository. Alchemy creates temporary deployment keys for its commands. The former
`CONVEX_DEPLOY_KEY` and `CONVEX_PREVIEW_DEPLOY_KEY` repository secrets are no longer read by this
workflow.

Each stage has one queue shared by deployment and cleanup. Before deployment,
`scripts/verify-deployment-head.ts` checks that the checkout is still the head of the branch.
GitHub CI runs `pnpm run check` separately. Deployment does not repeat it.

The team's `alchemy-state` Convex project stores the stack state. Its `samebase.run` output
records the repository, stack file, branch, commit, pull request, and workflow run for Samebase's
repository overview. `SCOUT_COMMIT` is a deployment input so a change outside `apps/scout` also
deploys. Existing R2 settings and other deployment environment variables remain unmanaged.

New development and preview deployments take `JWT_PRIVATE_KEY`, `JWKS`, and the
`DEV_SEED_AUTH_*` values from the project's environment defaults. Production keeps its own
signing keys and `SITE_URL`.

## Local inspection

Use the Convex CLI login or set `CONVEX_ACCESS_TOKEN` for the intended team. Run Alchemy from the
repository root:

```sh
pnpm exec alchemy plan --stage prod --no-input
```

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
