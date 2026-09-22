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

## Build Variables

Set these build secrets in the Cloudflare Workers Builds settings:

- `CONVEX_DEPLOY_KEY`
- `PREVIEW_CONVEX_DEPLOY_KEY`

Do not add `VITE_CONVEX_URL`. Convex supplies the selected deployment URL to the frontend command
that runs through `convex deploy --cmd`.

Cloudflare Workers Builds has separate production and preview build triggers
under the hood, but the dashboard currently shows one build-variable table. To
keep dashboard and API-created configurations equivalent, store both secrets on
both triggers. This also keeps the production and preview keys visible in the
dashboard. Keep this shared layout until Cloudflare exposes separate production
and preview build-variable views.

This template handles that dashboard limitation in `apps/scout/scripts/build-cloudflare.ts`:

1. It reads `WORKERS_CI_BRANCH`.
2. It selects `CONVEX_DEPLOY_KEY` when the branch is `main`.
3. It selects `PREVIEW_CONVEX_DEPLOY_KEY` for every other branch.
4. It passes only the selected value to the Convex deploy subprocess as
   `CONVEX_DEPLOY_KEY`.

That keeps the production key compatible with projects that do not use the
preview-aware wrapper, while still requiring a separate preview key for
non-production branches.

When configuring through the Builds API, write the same two secrets to both
triggers. When configuring through the dashboard, enter both secrets in its
build-variable table. The script selects the correct key for each branch and
keeps preview builds from falling back to the production key.

## Build Ordering

Non-production builds pass `WORKERS_CI_BRANCH` to Convex as the stable preview
name, so repeated commits reuse one preview deployment, URL, and data.

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
frontend's files. Local builds without deploy keys remain frontend-only; dry-runs do not
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

## Local Checks

Local dry-runs can validate the Worker package without build secrets. Set
`CLOUDFLARE_WORKER_NAME` using the [platform-specific commands in the README](../README.md#checks-and-builds),
then run:

```sh
pnpm run deploy:dry-run
pnpm run deploy:preview:dry-run
```

If you set either deploy key locally, also set `WORKERS_CI_BRANCH` so the
script can choose the intended deployment target.

## References

- [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Workers Builds API reference](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)
