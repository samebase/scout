# Deploy

Convex serves TrailScout next to its backend with
[`@samebase/convex-hosting`](https://github.com/samebase/convex-hosting), at
`https://<deployment>.convex.site`. `pnpm run deploy` in `apps/scout/` builds the app, uploads
`dist/client` to the hosting component, and pushes the Convex functions. The push switches the
site. `convex/http.ts` answers a path without an uploaded file with the TanStack Start server
build.

GitHub Actions deploys. GitHub CI runs `pnpm run check` separately; the deploy workflows do not
rerun it.

- `.github/workflows/deploy.yml`: a push to `main` deploys production with the repository secret
  `CONVEX_DEPLOY_KEY`.
- `.github/workflows/preview.yml`: a pull request from this repository deploys a Convex preview
  named after its branch with the repository secret `CONVEX_PREVIEW_DEPLOY_KEY`. It seeds the
  development password account, sets the preview's `SITE_URL` to its site URL, and comments that
  URL on the pull request. Later pushes reuse the preview until Convex deletes it.

Each workflow runs one deploy at a time per deployment and refuses a commit that is no longer the
head of `main` or of the pull request. A key limited to some actions needs the permissions in the
package README's [deploy tools and CI](https://github.com/samebase/convex-hosting#deploy-tools-and-ci)
section.

New development and preview deployments take `JWT_PRIVATE_KEY`, `JWKS`, and the
`DEV_SEED_AUTH_*` values from the project's environment defaults. Production keeps its own
signing keys and `SITE_URL`.

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
