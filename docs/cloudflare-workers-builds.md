# Cloudflare Workers Builds

This app deploys through Cloudflare Workers Builds. The Cloudflare dashboard runs
`pnpm run build`, then runs `pnpm run deploy` for the production branch or
`pnpm run deploy:preview` for other branches. The build command publishes and verifies the
frontend on Convex Static Hosting immediately after deploying its backend. The deploy command
then publishes the same frontend build to Cloudflare.

GitHub CI runs formatting, lint, type checks, and tests through `pnpm run check`. Workers Builds
only builds and deploys the app; it does not rerun the test suite.

Keep the Workers Builds root directory at the repository root. These commands use Vite+
to run the `samebase-scout` app in `apps/scout/`, where its Convex and Wrangler configuration
live. The frontend output is `apps/scout/dist/client`.

`pnpm run build`, `pnpm run deploy`, and `pnpm run deploy:preview` are the stable repository
interface. Outside Workers Builds, `pnpm run build` runs only the app build.

## Build Variables

Set `CONVEX_DEPLOY_KEY` separately in the Cloudflare Workers Builds settings:

- **Settings > Builds > Production**: a Convex production deploy key.
- **Settings > Builds > Previews Base**: a Convex project Preview deploy key.

The Previews Base section here contains shared preview build settings. Do not put deploy keys in
**Runtime variables and secrets**, which exposes them to Worker code and does not supply the build.

Do not add `VITE_CONVEX_URL`. Convex supplies the selected deployment URL to the frontend command
that runs through `convex deploy --cmd`.

Each build scope supplies its own `CONVEX_DEPLOY_KEY`. The build script uses `WORKERS_CI_BRANCH` to
select production or a named Convex preview. It does not choose between two secret names.
After both builds succeed, delete `PREVIEW_CONVEX_DEPLOY_KEY` from both build scopes.
The current scripts do not read it.

## Build Ordering

Non-production builds pass `WORKERS_CI_BRANCH` to Convex as the stable preview
name. Auth environment commands, seed data, static uploads, and release verification use the same
explicit preview name, so repeated commits reuse one preview deployment, URL, and data.

A preview deployment that sends human-handoff emails must set Convex Auth's `SITE_URL` to the
intended preview app origin. Preview builds upload assets to their named Convex preview, so
either that `convex.site` origin or the matching Cloudflare preview can host the frontend.
Production should also set `SITE_URL` to its canonical app origin.

Cloudflare may build more than one commit from the same branch concurrently.
Stable naming does not order those builds: without another check, an older build
that finishes last can replace newer Convex functions. After building the app
and immediately before Convex pushes functions, this template compares the
checked-out Git commit with the remote head of `WORKERS_CI_BRANCH`. A stale
build fails without deploying Convex. The checkout is authoritative because a
manual Workers Build can report the branch name in `WORKERS_CI_COMMIT_SHA`. The
check applies to `main` too, where the same overlap could otherwise roll
production back.

The build checks the branch head again before uploading the Convex assets, and the deploy
command checks it before publishing Cloudflare. Each check makes an authenticated
`git ls-remote` request.
It is not an atomic compare-and-swap. A branch can still advance in the short
interval between the Git check and Convex's internal push. Eliminating that
residual race requires provider-side serialization or a Convex source-commit
concurrency primitive.

## Release order and asset retention

For production and named preview Workers Builds, the build command:

1. Builds the browser files and renderer with one unique build marker.
2. Deploys the Convex backend, including the renderer and its small build metadata file.
3. Uploads `dist/client` to the selected Convex deployment. The component stages the upload,
   then publishes the complete manifest in one mutation.
4. Checks the deployed backend's `/__convex_build` metadata, the matching published marker,
   and every emitted `/assets/` file over HTTP. JavaScript and CSS must have the correct MIME
   type, and every asset's bytes must match the local build. The marker checks run again after
   the assets to catch a concurrent publication.
5. Configures auth and, for previews, seeds the development account.

Cloudflare publication runs afterward. A Cloudflare failure no longer delays the Convex
frontend's files. Local builds remain frontend-only; dry-runs do not
publish Convex assets. `pnpm run deploy:convex` also verifies its completed release.

Every renderer knows its own marker path, `/__convex_build/<unique-build-id>`. Before loading
the renderer, the HTTP handler checks for that exact marker in the active static manifest.
Until it exists, normal static hosting serves the published shell and prerendered pages.
The first deployment returns the component's setup response until its initial upload succeeds.
A partial or failed upload leaves the preceding static release available and fails the build
command. It does not automatically retry or change the `TANSTACK_SERVER_ENABLED` setting.

The patched Static Hosting component keeps outgoing component-storage files for at least
seven days after replacement, protecting requests that already resolved their storage URLs.
Only retired non-HTML `/assets/` paths remain publicly resolvable. Old HTML and build markers
are never selected from the archive. An indexed `retiredAssets` table keeps historical files
outside the active-manifest transaction limits. Existing bounded upload maintenance removes
expired rows and their unreferenced storage; without another upload, they can remain longer.
The uploader currently uploads fresh storage objects for unchanged files too, so retained
storage grows with seven days of build volume. This policy applies to Convex component storage,
not the optional ConvexFS CDN mode or Cloudflare's separate asset store.

This protects old tabs' browser files during the retention window. It does not make old
frontend code compatible with arbitrary backend API changes. Branch checks and final build
verification detect many overlaps, but do not serialize publishers; a mismatch fails visibly
and needs an explicit rerun of the intended build.

Missing `/assets/` requests return 404 with `no-store`, without rendering a page or serving
the SPA shell. The Convex hosting layer has been observed to override missing `.js` and `.css`
responses with a four-hour browser cache policy. Release safety therefore depends on keeping
referenced assets available, not on a client reload or the host preserving that header.

## Worker Previews

`pnpm run deploy:preview` checks the current branch head and runs `wrangler preview`.
Wrangler reads `WRANGLER_CI_OVERRIDE_NAME` in Workers Builds. The repository does not need a fixed
Worker name or a name adapter. For a local command, pass `--worker-name <connected-worker-name>`.
Wrangler's `--name` option selects the Preview, not the parent Worker.

Wrangler 4.135.0 or later and a `previews` configuration block are required. This application serves
static assets through Cloudflare, so `apps/scout/wrangler.jsonc` uses `previews: {}`.
Its Convex Static Hosting upload, auth setup, and release checks remain part of the build.

Existing Workers need **Settings > Builds > Set up Worker Previews**. The switch is irreversible
and changes the preview command to `npx wrangler preview`. Restore `pnpm run deploy:preview`,
keep the build root at the repository root, and keep `pnpm run build` as the build command.
New connections use Worker Previews by default.

After switching and before a branch build, set `CONVEX_DEPLOY_KEY` in Previews Base build settings
to the project Preview key. The switch removes the old preview trigger, so do not use an old
preview trigger ID to configure these settings.
Keep the production key and `SAMEBASE_CONVEX_PROJECT` on Production only. Verify a branch preview,
its matching Convex deployment, auth, and static-release checks. Production rollout is a separate
approved step. After both builds pass, remove any `PREVIEW_CONVEX_DEPLOY_KEY` left in Production
or Previews Base build settings and remove any `SAMEBASE_CONVEX_PROJECT` from Previews Base
build settings.

Runtime secrets belong under Runtime **Previews Base**, separately from Builds secrets. Base
secret changes apply to newly created Previews. This code change does not switch provider settings.

## Local Checks

Build and validate the Worker package without publishing it:

```sh
pnpm run deploy:dry-run
```

This command does not deploy Convex. Worker Previews has no dry-run mode. After building locally,
use the connected Worker name to publish a Preview:

```sh
pnpm run deploy:preview --worker-name my-worker
```

## References

- [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Workers Builds API reference](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)
