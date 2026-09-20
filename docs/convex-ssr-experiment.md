# TanStack Start inside a Convex HTTP action

Tested on September 20, 2026. TanStack Start can render directly in a hosted Convex
HTTP action with the versions Scout currently uses. No Cloudflare server, Node
action, stream polyfill, or fork of Static Hosting is needed for this approach.

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
section. This was an HTML-only check of the existing homepage shell. Scout's
browser assets and full backend were not deployed there, and its real feed has
not yet been converted to server loading.

## Working configuration

The custom TanStack server entry is only:

```ts
import { createStartHandler, defaultRenderHandler } from "@tanstack/react-start/server";

export default { fetch: createStartHandler(defaultRenderHandler) };
```

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

The HTTP integration follows this shape:

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
working `defaultRenderHandler` buffers a complete HTML document and expects the
data needed for that document to be awaited in loaders. Streaming Suspense was
not demonstrated.

An intermediate Node-action attempt deployed but failed at runtime on the
sidebar's dynamic React import. That route and action were removed from the
final probe once direct HTTP rendering worked.

Turning this into Scout's submission still requires:

1. A bounded public-homepage loader containing the initial sites and review
   summaries, with a stable handoff to subscriptions and pagination.
2. A request-scoped Convex client for SSR. The application's current module-level
   client should not become shared server authentication state.
3. Build and deployment ordering that bundles the server before the Convex push
   and publishes matching browser assets. The Static Hosting uploader requires
   an `index.html` even with SPA fallback disabled; the probe generated one, while
   the exact HTTP route served the dynamic homepage.
4. Verification of public/private scopes, authentication transitions, pagination,
   concurrent requests, larger responses, and the rest of the application's
   browser behavior. Personalized SSR and TanStack server functions were not tested.

The full Scout build and hosted push succeeded with an existing `outdent`
CommonJS-in-ESM warning in a workspace chunk. The homepage request did not hit an
error, but this is not evidence that every authenticated route can be rendered.

Installed versions: Convex 1.45.0, Static Hosting 0.2.1, TanStack Start 1.168.34,
TanStack Router 1.170.18, React and React DOM 19.2.6.

## Workspace extraction

The reusable code now lives in the private workspace package
[`@samebase/convex-tanstack-start`](../packages/convex-tanstack-start/README.md).
Its Vite plugin is 16 lines and its buffered server entry is three lines.
It needs no component schema because it owns no persistent state.

The [runnable example](../apps/convex-ssr-example/README.md) keeps its page loader,
synthetic database, subscriptions, and HTTP mounts separate from the library.
The complete `convex/http.ts` is 19 lines. All authored source is visible in the
repository; generated server bundles remain ignored. Scout's production frontend
has not been migrated.

The extracted example replaced the scratch implementation on the same temporary
development deployment. Both document routes returned 200 with `no-store` and
the homepage contained its database records in the HTML. Hydration and a live
mutation were rechecked; the new title appeared while the counter retained its
value. The experimental `/scout-shell` mount is no longer installed there.

Repository validation passed with `pnpm run check`: 103 test files passed, one
skipped; 1,460 tests passed and 11 skipped. `pnpm run build`, the example build,
and Convex's TypeScript check and hosted push also passed. No production or
pre-existing development deployment was changed. The original scratch builds and
raw response evidence remain locally in the ignored `apps/scout/ssr-probe.local/`.

References: [TanStack server entry](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point),
[Convex runtimes](https://docs.convex.dev/functions/runtimes), and
[Static Hosting](https://github.com/get-convex/static-hosting).
