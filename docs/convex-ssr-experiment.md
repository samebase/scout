# TanStack Start inside a Convex HTTP action

Tested on September 21, 2026. TanStack Start can render directly in a hosted Convex
HTTP action with the versions Scout currently uses. Scout's real public homepage
now uses this renderer. No Cloudflare server, Node action, or stream polyfill is
needed at runtime.

## Try Scout on this pull request

[Open Scout's Convex preview](https://clever-vole-526.eu-west-1.convex.site/).
The region is part of its URL; `clever-vole-526.convex.site` is not this deployment.

The preview uses Scout's actual frontend, schema, queries, authentication, and
Static Hosting component. Its eight `ssr-*.example` sites contain labeled synthetic
reviews because the preview database was empty. Each has one public and one
private review. No browser session or model was started to create them.

To check server rendering, open View Page Source and search for `public review`.
The six initial site cards and review headings should already be HTML. The live
browser loads the remaining sites when you scroll. Filtering and opening a task
exercise the normal Scout app. `private review` must never appear in the public
HTML or feed.

[Open an actual site page](https://clever-vole-526.eu-west-1.convex.site/sites/ssr-8.example).
This is Scout's `/sites/$site` route. Its site heading, public reviews, and sites
sidebar are present in View Page Source. Direct visits work with no query string,
with `?scope=public`, and with `?scope=public&view=tasks`. The site records are
synthetic preview data; the route and components are the same ones Scout uses.

Public task reviews also render their title, task navigation, initial transcript,
and saved walkthrough text through the same query integration. Screenshot URLs and
interactive browser controls load in the browser. `/scouts` and `/scouts/$slug`
render the public directory and profile, including service names. Account identifiers
and runtime resources still require authenticated queries. Task URLs with
`scope=mine` use the SPA shell; a private task opened without that parameter also
returns no private data and waits for browser authentication.

## Current query integration

Scout uses the [official Convex TanStack Query setup](https://docs.convex.dev/client/tanstack/tanstack-start/).
Each router owns a Convex client and query cache. `ConvexAuthProvider` shares that
client, and `setupRouterSsrQueryIntegration` serializes and hydrates the cache.
Public page components use `useSuspenseQuery(convexQuery(api.module.query, args))`.
There is no homepage loader or `initialFeed` prop.

The official adapter does not implement paginated hooks. One shared
`useSsrPaginatedQuery` hook queries the first page through the official adapter
and preserves it until native `usePaginatedQuery` connects. Convex owns cursor
advancement, page splitting, and live updates. Both subscriptions remain active,
so this currently costs one additional first-page subscription per list.

Every unmatched GET goes to TanStack, which owns route matching and Not Found.
Public routes inherit SSR. The homepage and site route disable it for personal or
workspace views; browser-dependent routes explicitly set `ssr: false`.
No route list is registered in the HTTP action, and new ordinary public queries
do not need custom server data plumbing. Personalized SSR is still out of scope.

The Convex adapter awaits React's `renderToReadableStream(...).allReady` and passes
the completed HTML to TanStack's `renderSsrHtmlResponse`. This is needed because
`defaultRenderHandler` uses `renderToString`, which does not await Suspense,
while `defaultStreamHandler` imports Node streams that Convex cannot bundle.
Route matching, query hydration, response status, and cleanup remain framework-owned.
Only About, Privacy, and Terms prerender. The homepage uses the universal SPA
shell in static mode, including on the Cloudflare assets host. This keeps builds
independent of backend data and avoids incomplete Suspense markup during rollback.

Run `pnpm run check` for the automated coverage. The renderer tests delay an
official Convex query and require its content and hydration data in the completed
response. Component tests cover private access, authentication transitions, and
navigation while queries are pending.

For a hosted smoke check, disable JavaScript in the browser and reload a public
site, task, or Scout URL. Its content should already be visible. Re-enable
JavaScript and check navigation and a direct reload. Check private URLs while
signed out, including their response HTML and serialized data. The hosted results
below record the release checks; they are not a separate test runner.

Verified for public task and Scout routes on the hosted preview on September 21, 2026:

- All 20 raw-response checks passed, including a task URL without search parameters,
  its transcript, walkthrough, personal-scope shell, and Scout directory/profile.
- Separate checks found no private fixture titles, Scout email, inbox IDs, or browser
  profile names in anonymous HTML or serialized query data, including a real private task URL.
- Chrome loaded and reloaded the task and profile, switched review views, and navigated
  back to the directory without warnings or errors. The private task showed sign-in.
- With SSR disabled, direct task and Scout URLs returned the SPA shell and loaded in
  Chrome. The preview is left enabled. Production was not changed.
- The hosted walkthrough fixture has no screenshots. Its empty notice renders on the
  server; a separate delayed-query test uses the real walkthrough component to verify
  summary, check, and step HTML and that screenshot actions run only in the browser.

Component tests use the real query cache to check UI responses to seeded query results
and simulated authentication updates. They do not exercise the full transition from
SSR hydration to authenticated Convex subscriptions. No signed-in preview browser
session was used for this pass.

Verified on the hosted `clever-vole-526` preview on September 20, 2026:

- The raw-response check passed all 14 paths. The homepage contained six site
  cards; its filtered URL contained one. The direct site URL contained its
  identity, public review, and eight sidebar cards with and without query parameters.
  Private views contained no reviews.
- Chrome hydrated the homepage and direct site page, switched sites, filtered
  the feed, and loaded all eight fixture sites through native pagination.
  The first About navigation retained one menu. Console warnings and errors were empty.
- With `TANSTACK_SERVER_ENABLED=false`, the homepage and direct site returned
  the SPA shell, loaded their content in Chrome, and reloaded without console errors.
  The preview is left enabled. Production and the shared dev deployment were not changed.
- `pnpm run check` passed 1,579 tests. Scout and the example app built successfully;
  the Convex preview push passed its TypeScript and bundle checks.

Static Hosting still owns uploads, storage, and serving built assets. Its patched
`fallback(request)` callback runs after an exact asset miss, before static rewrites
and SPA fallback. A response is returned unchanged; `null` continues normal static
serving. Callback errors propagate instead of silently switching modes. The callback
does not run for uploaded files or more-specific Convex auth and webhook endpoints.
This hook handles GET documents; it does not add POST server-function support.

With TanStack serving disabled, public prerenders and the universal `/index.html`
fallback work as before. Dots and Accept headers do not affect shell fallback.
HTML responses set `Cache-Control: no-store`.
In hosted preview checks, Convex preserves that header for site URLs but overrides
it with `public, max-age=14400` on missing `.js`, `.png`, and `.pdf` URLs. Browsers
can cache the static shell or TanStack Not Found response there for four hours.

### Enable or disable TanStack serving

Set `TANSTACK_SERVER_ENABLED` in the target Convex deployment's environment settings.
`true` enables TanStack's server handler; `false` or an unset value restores static
prerenders and the SPA shell for all pages. The HTTP handler reads the setting on
each request, so changing it does not require a rebuild or code deployment.
This replaces `HOMEPAGE_SSR_ENABLED`, which no longer controls serving. A deployment
with only the old variable set starts in static mode until the new variable is enabled.

For this PR preview, run either command from the repository root:

```sh
pnpm --filter samebase-scout exec convex env set TANSTACK_SERVER_ENABLED false --deployment clever-vole-526
pnpm --filter samebase-scout exec convex env set TANSTACK_SERVER_ENABLED true --deployment clever-vole-526
```

The disabled path never imports or initializes the renderer. Static Hosting reads
the already-published prerender or shell directly, without an HTTP request back to
the app. The homepage and all data pages use `/index.html` in static mode, so filters
initialize in the browser without a prerender hydration mismatch. With serving disabled,
View Page Source contains the page shell without review cards; the browser still
loads the feed. With serving enabled, the first six cards are in the response HTML.

This is a manual switch, not an automatic error fallback. It does not repair
missing static assets, shared backend failures, or a failed build. Builds still
need to generate the server bundle before pushing Convex. The code defaults to static serving when the variable is unset. Project environment
defaults currently enable it; upload matching assets before verifying a new deployment.

### Build and deploy to an existing preview

After selecting a preview, run these platform-neutral commands from the root:

```sh
pnpm --filter samebase-scout exec convex deployment select clever-vole-526
pnpm run check
pnpm run build
pnpm --filter samebase-scout exec convex env set TANSTACK_SERVER_ENABLED false --deployment clever-vole-526
pnpm --filter samebase-scout exec convex dev --once --typecheck enable
pnpm --filter samebase-scout exec static-hosting upload --dist ./dist/client --preview-name nicu-convex-tanstack-ssr
pnpm --filter samebase-scout exec convex env set TANSTACK_SERVER_ENABLED true --deployment clever-vole-526
```

The backend imports the generated server, so the build must precede its push.
Normal `pnpm run dev` now does this initial build automatically. Rebuild after
frontend edits to refresh the hosted renderer; Vite still hot-reloads locally.
The CI preview path builds before deploying and uploads matching browser assets
afterwards. It does not toggle this setting automatically. If TanStack serving is
already enabled, use the manual sequence above for releases: otherwise the interval
between backend deployment and asset upload can reference missing browser files.
The existing Static Hosting patch adds explicit `--preview-name`
forwarding, since 0.2.1's uploader otherwise does not target a named preview.

Build-time prerendering includes only data-free pages. Convex runs the build
before pushing the backend, so a new preview may not have queries deployed yet.

### Optional preview fixtures

The internal `devSsr:seed` mutation is opt-in and idempotent. It requires the
existing approved development seed account and an exact deployment URL match.
To populate an empty preview, enable it for that preview, seed, and disable it:

```sh
pnpm --filter samebase-scout exec convex env set SSR_FIXTURE_DEPLOYMENT_URL https://clever-vole-526.eu-west-1.convex.cloud --deployment clever-vole-526
pnpm --filter samebase-scout exec convex run devSsr:seed '{}' --deployment clever-vole-526
pnpm --filter samebase-scout exec convex env remove SSR_FIXTURE_DEPLOYMENT_URL --deployment clever-vole-526
```

The disabled fixture Scout cannot start tasks. Use real configured Scouts to test
agent execution separately.

### Earlier generic routing verification

The final build was deployed to `clever-vole-526` on September 20, 2026, and tested
with `TANSTACK_SERVER_ENABLED` false, true, false, then true without rebuilding
between switch changes. The preview is left enabled.

| Request                             | TanStack enabled                              | Static rollback                   |
| ----------------------------------- | --------------------------------------------- | --------------------------------- |
| `/`                                 | 200; six public review cards in HTML          | 200; prerender without live cards |
| `/?scope=mine`                      | 200; no public or private review titles       | 200; SPA shell                    |
| `/about`                            | 200; page content in HTML                     | 200; prerender                    |
| `/sites/ssr-8.example?scope=public` | 200; native client-rendered route             | 200; SPA shell                    |
| Unknown URL                         | 404; router renders Not Found after hydration | 200; SPA renders Not Found        |
| `//about`                           | 308; Location points to `/about`              | Not part of rollback check        |
| Built JavaScript and auth discovery | 200; correct content types                    | 200; correct content types        |

Browser checks covered the homepage, About, direct site and task links, sign-in,
and an unknown route. The final checks reported no console warnings or errors.
Rollback checks caught and fixed shared-shell hydration mismatches in navigation,
the account gate, and Not Found. These use native `ClientOnly` boundaries; public
page content still renders on the server. No signed-in session or paid task was
created during verification.

Two independent reviews checked runtime behavior and the dependency/deployment
patch. A real TanStack redirect exposed immutable response headers; the HTTP
adapter now copies the response before applying cache policy. The full check passed
1,560 tests, and the production build and hosted Convex type check passed. Tests
exercise the real patched Static Hosting adapter, preserve redirect/error statuses,
verify renderer-import failure rollback, and keep protected routes client-only.

### Earlier homepage-only verification

- `GET /` returned 200 and 58,328 bytes of HTML containing six `<article>` cards
  and six public review headings, with `Cache-Control: no-store`.
- Concurrent requests for `/`, `/?site=ssr-8`, `/?scope=mine`, and
  `/?site=missing` returned 200 with six, one, zero, and zero server-rendered cards.
  None contained the private review titles. These requests took 432–623 ms from
  the test machine; they are not load-test or cold-start guarantees.
- The open Scout browser received newly seeded reviews without a reload.
  Fresh SSR loads hydrated, site filtering worked, and native pagination exposed
  all eight sites. Public task navigation and a direct task reload also worked.
- No browser warnings or errors were reported during those checks.
- The homepage switch was exercised on the preview with unset, `false`, and `true`
  settings. Static mode returned HTML without review cards, then loaded the feed
  in the browser. A filtered reload worked without hydration errors. Re-enabling
  SSR restored six cards in the initial response without a rebuild or deployment.

## Hosted evidence

The isolated development deployment is `nicu:scout:dev/ssr-probe-61c2`, named
`adamant-panda-546`. It was created with a seven-day expiration.

- [Working prototype](https://adamant-panda-546.eu-west-1.convex.site/)
- [Second SSR route](https://adamant-panda-546.eu-west-1.convex.site/about)
- [Deployment dashboard](https://dashboard.convex.dev/t/nicu/scout/adamant-panda-546)

The prototype uses two synthetic records in a Convex table. A TanStack route
loader queries that deployment with `ConvexHttpClient`. The HTTP action invokes
the built TanStack server's `fetch` handler directly. Convex Static Hosting serves
the browser JavaScript. A native `useQuery` subscription takes over from the
route's initial loader data after hydration.

Verified against the hosted deployment:

- The initial HTTP response contains both records as `<li>` elements and the
  serialized TanStack loader data. JavaScript is not needed to populate the list.
- Clicking the counter changes it from zero to one, proving hydration and event
  handlers work.
- Renaming a fixture to `Updated without rebuilding` updates the open browser
  without a reload. The counter remains at one.
- Subsequent HTTP responses contain the updated title without rebuilding or
  uploading assets. The document route sends `Cache-Control: no-store`.
- Navigation to `/about` and a hard reload of that route both work.
- The browser reported no console warnings or errors during these checks.
- Five sequential document requests returned 200 in 218, 153, 109, 116, and
  101 ms, including network transfer from this Mac. These measurements cover a
  two-record prototype, not production load or cold-start guarantees.

Scout's actual frontend was also built with the same renderer and dependency
settings, imported into the probe's HTTP router, and requested at `/scout-shell`.
It returned 200 with 16,163 bytes of HTML containing Scout's heading and Reviews
section. That earlier shell-only experiment is superseded by the real Scout
integration above.

## Working configuration

Scout's `src/server.ts` uses the shared server entry:

```ts
export { default } from "@samebase/convex-tanstack-start/server";
```

The shared entry also installs `URLSearchParams.size` when the runtime lacks that getter.
The hosted Convex runtime returned `undefined` for it. Without the getter,
TanStack normalizes `/?site=ssr-8` into `/site=ssr-8` and returns 404. A regression
test reproduces that behavior using TanStack's actual URL normalizer and verifies
the fix, including duplicate parameters and native-runtime preservation.

The relevant Vite settings are:

```ts
ssr: {
  noExternal: true,
  resolve: { conditions: ["worker", "browser", "module", "import"] },
},
resolve: {
  alias: [{ find: /^react-dom\/server$/, replacement: "react-dom/server.edge" }],
},
```

`worker` selects TanStack's server behavior. `browser` selects Web API-compatible
dependencies such as H3 instead of their Node adapters. React's edge renderer
avoids the browser renderer's `MessageChannel` requirement. Bundling dependencies
also removes the sidebar package's runtime `require("react")` boundary. The final
server bundle imports only `node:async_hooks`, which Convex supports.

Use `src/server.ts` for automatic entry discovery. If explicitly configuring
`server.entry`, the installed Start plugin resolves it relative to `srcDirectory`;
an absolute path silently fell back to the default entry during this experiment.

The initial prototype used this HTTP integration:

```ts
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const response: Response = await app.fetch(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }),
});

registerStaticRoutes(http, components.staticHosting, { spaFallback: false });
```

The exact homepage route wins over Static Hosting's prefix route. The prototype
imports the generated server entry from outside `convex/`; Convex bundles that
import. The generated `.js` files are Vite output, not authored source.

## Boundaries and remaining work

The stock `defaultStreamHandler` failed Convex bundling on `node:stream` and
`node:stream/web`. The original Scout bundle also imported `node:module`. The
original `defaultRenderHandler` buffered a complete HTML document and required
loader data. The current adapter described above also awaits query Suspense,
while still returning a buffered response.

An intermediate Node-action attempt deployed but failed at runtime on the
sidebar's dynamic React import. That route and action were removed from the
final probe once direct HTTP rendering worked.

Personalized SSR, incremental response streaming, TanStack server functions, production load,
and cold-start latency remain outside the verified scope. The initial page is
bounded to six sites rather than rendering an unbounded collection. Private
pages continue to authenticate and load through the existing browser queries.

The full Scout build and hosted push succeeded with an existing `outdent`
CommonJS-in-ESM warning in a workspace chunk. The homepage request did not hit an
error, but this is not evidence that every authenticated route can be rendered.

Current dependency versions are recorded in the [Scout manifest](../apps/scout/package.json)
and the [integration package manifest](../packages/convex-tanstack-start/package.json).

## Workspace extraction

The reusable code now lives in the private workspace package
[`@samebase/convex-tanstack-start`](../packages/convex-tanstack-start/README.md).
It contains the Vite plugin and buffered server entry, including the
URLSearchParams compatibility getter.
It needs no component schema because it owns no persistent state.

The [runnable example](../apps/convex-ssr-example/README.md) keeps its page loader,
synthetic database, subscriptions, and HTTP mounts separate from the library.
All authored source is visible in the repository; generated server bundles remain
ignored. Scout consumes the same package, with component queries and its own HTTP
routing. This branch is deployed to the Scout preview, not production.

The extracted example replaced the scratch implementation on the same temporary
development deployment. Both document routes returned 200 with `no-store` and
the homepage contained its database records in the HTML. Hydration and a live
mutation were rechecked; the new title appeared while the counter retained its
value. The experimental `/scout-shell` mount is no longer installed there.

Repository validation includes `pnpm run check`, the Scout and example builds,
and Convex's TypeScript check and hosted push. Tests cover the initial-to-live
handoff, public filtering, seed isolation, HTTP cache policy, and URL normalization
without `URLSearchParams.size`. The HTTP test also passed with the generated server
directory temporarily absent, matching a clean CI checkout. Production was not
changed. The original probe evidence remains in the ignored
`apps/scout/ssr-probe.local/`; the real Scout checks above used the PR preview.

References: [TanStack server entry](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point),
[Convex runtimes](https://docs.convex.dev/functions/runtimes), and
[Static Hosting](https://github.com/get-convex/static-hosting).
