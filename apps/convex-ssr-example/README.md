# Convex SSR example

A small consumer of [`@samebase/convex-tanstack-start`](../../packages/convex-tanstack-start).
The initial HTML contains two synthetic database records. React hydrates a counter,
TanStack handles navigation, and a Convex subscription keeps the list current.
The example has its own Convex schema and should use a dedicated development
deployment.

## Run

Run commands from the repository root. Install with `vp install`.

Select or create a dedicated Convex development deployment from this app:

```sh
pnpm --filter @samebase/convex-ssr-example exec convex deployment create <team>:<project>:dev/ssr-example --type dev --select
```

Check `apps/convex-ssr-example/.env.local`. `CONVEX_DEPLOYMENT` must identify the
example's deployment, and `VITE_CONVEX_URL` must be its `.convex.cloud` URL. Do not
point the example at Scout's backend, since their schemas are different.

The server bundle must exist before pushing the backend that imports it:

```sh
pnpm --filter @samebase/convex-ssr-example run build
pnpm run check
pnpm --filter @samebase/convex-ssr-example exec convex dev --once
pnpm --filter @samebase/convex-ssr-example exec convex run listings:seed
pnpm --filter @samebase/convex-ssr-example exec static-hosting upload --dist ./dist/client --no-spa
```

Open that deployment's `.convex.site` URL. Both `/` and `/about` render in HTTP
actions; Static Hosting serves JavaScript and other assets. The uploader requires
an `index.html` even with SPA fallback disabled. `public/index.html` satisfies that
requirement and redirects direct visits to the dynamic `/` route.

For frontend development after the backend is deployed:

```sh
pnpm --filter @samebase/convex-ssr-example run dev
```

Rebuild, push the backend, and upload its matching assets after changing frontend
code. Backend and asset uploads are separate steps; this example does not provide
an atomic release mechanism. Root `pnpm run build` still builds Scout only.

## Verify

1. Inspect the homepage's response HTML. Both hostnames should be inside `<li>`
   elements before browser JavaScript runs.
2. Click the counter, navigate to About, and hard-refresh `/about`.
3. Return home, click the counter, and run the internal mutation from the dashboard
   or CLI: `listings:rename` with `{"title":"Updated without rebuilding"}`.
   The list should update while the counter retains its value. A fresh HTTP
   response should contain the new title too.

The query exposes only synthetic public records. Seed and rename are internal
mutations. Generated Convex files and `src/routeTree.gen.ts` are committed for
clean-checkout typechecking; Vite's `dist/` remains ignored. The authored source
is TypeScript. Convex's generated runtime files and Vite's server output are
JavaScript because those tools emit JavaScript.
