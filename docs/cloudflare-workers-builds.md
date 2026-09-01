# Cloudflare Workers Builds

This app deploys through Cloudflare Workers Builds. The Cloudflare dashboard uses these stable
repository commands:

| Builds stage | Production branch | Other branches            |
| ------------ | ----------------- | ------------------------- |
| Build        | `pnpm run build`  | `pnpm run build`          |
| Deploy       | `pnpm run deploy` | `pnpm run deploy:preview` |

The repository owns the implementation under these names. Outside Workers Builds,
`pnpm run build` runs only the app build.

## Build Variables

`CONVEX_DEPLOY_KEY` is a build secret. The Convex CLI needs it before Wrangler uploads the Worker.
Use one key name with a different value on each Workers Builds trigger:

| Workers Builds trigger | Secret name         | Secret value                      |
| ---------------------- | ------------------- | --------------------------------- |
| Production             | `CONVEX_DEPLOY_KEY` | Convex production deploy key      |
| Preview                | `CONVEX_DEPLOY_KEY` | Convex project Preview deploy key |

In the dashboard, put the production value under **Settings > Builds > Production**. Put the
preview value under **Settings > Builds > Previews Base**. The **Previews Base** tab in the Builds
section is the preview trigger's build configuration.

Do not add `VITE_CONVEX_URL`. Convex supplies the selected deployment URL to the frontend command
that runs through `convex deploy --cmd`.

Do not add a Convex deploy key under **Runtime variables and secrets**. That section configures the
running Worker. It does not provide variables to the Workers Builds process. Putting a deploy key
there does not fix the build and exposes a deploy credential to Worker code.

If this repository still has `PREVIEW_CONVEX_DEPLOY_KEY`, delete it from both Builds scopes after
the new production and Preview builds succeed. The current scripts do not read that value.

## Build Ordering

Non-production builds pass `WORKERS_CI_BRANCH` to Convex as the stable preview name. The Convex
deploy, Convex Auth environment commands, and preview seed use the same explicit preview name.
Repeated commits reuse one preview deployment, URL, and data.

A preview deployment that sends human-handoff emails must set Convex Auth's `SITE_URL` to the
matching Cloudflare Preview origin. Preview builds do not upload assets to Convex Static Hosting,
so their `CONVEX_SITE_URL` is not a usable frontend origin. Production must set `SITE_URL` to its
canonical app origin.

Cloudflare can build more than one commit from the same branch concurrently. Stable naming does
not order those builds. After the app build and immediately before Convex pushes functions, this
repository compares the checked-out commit with the remote head of `WORKERS_CI_BRANCH`. A stale
build fails without deploying Convex. The check also applies to `main`.

The check adds one authenticated `git ls-remote` request to each provider build. It is not an
atomic compare-and-swap. A branch can still advance between the Git check and the Convex push.

## Worker Previews

`pnpm run deploy:preview` runs:

```sh
wrangler preview --worker-name <connected-worker-name>
```

Wrangler uses the Git branch as the Preview name. Its `--name` option names the Preview, not the
Worker. The repository adapter reads `WRANGLER_CI_OVERRIDE_NAME` and passes the Worker through
`--worker-name`. This avoids a hard-coded name in `wrangler.jsonc`.

Enable Preview builds for non-production branches. Cloudflare can still show an **Enable Worker
Previews** banner when the Preview command is `pnpm run deploy:preview`. Cloudflare documents this
button as a command change from an old deploy command to `npx wrangler preview`. The Builds API has
no separate Worker Previews flag. Keep `pnpm run deploy:preview` because its repository adapter
already runs `wrangler preview`.

Worker Previews is a private beta. The Cloudflare account must have access to run the preview
deploy command.

Configure safe runtime variables, secrets, and bindings in Runtime **Previews Base** before you
share a Preview URL. A new Preview copies the Base settings when it is created. A later Base change
does not update an existing Preview. Production runtime settings do not become Preview settings
automatically.

## Production Hosting Order

For a `main` Workers Build, `pnpm run deploy`:

1. Publishes `dist/client` through the Cloudflare Worker.
2. Waits for Wrangler to finish successfully.
3. Uploads the existing `dist/client` directory to production Convex Static Hosting.

The Convex upload does not rebuild the app or deploy the backend again. Preview, dry-run, and local
deploy commands do not upload to the production `convex.site` app. If the Convex upload fails, the
deploy command fails after Cloudflare has published successfully. A later run can retry the upload.

## Local Checks

Local dry-runs can validate the Worker package without build secrets:

```sh
pnpm run deploy:dry-run
```

Worker Previews has no dry-run mode. For a local Preview deploy, set
`CLOUDFLARE_WORKER_NAME` and run `pnpm run deploy:preview`.

## References

- [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Workers Builds API reference](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)
- [Cloudflare Worker Previews documentation pull request](https://github.com/cloudflare/cloudflare-docs/pull/31775)
