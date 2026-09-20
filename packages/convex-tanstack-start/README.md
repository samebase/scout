# TanStack Start on Convex

Private workspace integration for rendering TanStack Start inside a Convex HTTP
action. No separate server host is required. The package contains a Vite plugin
and a buffered server entry. It does not own tables or require `app.use(...)`.
The existing Convex Static Hosting component serves the browser assets.

Scout uses this package to render its public homepage in a Convex HTTP action.
[`apps/convex-ssr-example`](../../apps/convex-ssr-example) is a smaller runnable example.

## Integration

Add `"@samebase/convex-tanstack-start": "workspace:*"` to an app's dependencies,
then enable the build settings in its Vite config:

```ts
import { convexSsr } from "@samebase/convex-tanstack-start/vite";

export default defineConfig({
  plugins: [convexSsr(), tanstackStart({ prerender: { enabled: false } }), react()],
});
```

Create `src/server.ts`:

```ts
export { default } from "@samebase/convex-tanstack-start/server";
```

Build the app, then import `../dist/server/server.js` in `convex/http.ts`.
Wrap its `fetch(request)` with the app's `httpAction`, register the document
routes, and let Static Hosting serve the remaining asset paths. See the
[complete HTTP integration](../../apps/convex-ssr-example/convex/http.ts).
The example declares the generated entry's type in
[`server-build.d.ts`](../../apps/convex-ssr-example/convex/server-build.d.ts) so
typechecking also works before the first build.

Await initial page data in a TanStack loader. The example uses `ConvexHttpClient`
in its loader, then `useQuery` with the loader result as initial content until the
live subscription responds. HTTP mounts, data access, authentication, and cache
policy remain app decisions.

## Why these settings exist

- `worker` selects TanStack's server exports; `browser` selects Web API adapters.
- `react-dom/server.edge` avoids the browser renderer's `MessageChannel` dependency.
- `ssr.noExternal` bundles dependencies instead of leaving runtime Node imports.
- `defaultRenderHandler` buffers HTML. The default streaming handler imports Node
  stream modules that failed Convex bundling in the tested versions.
- The server entry supplies the missing `URLSearchParams.size` getter on Convex.
  TanStack needs it to normalize URLs containing query parameters. Native
  implementations are left intact.

These settings apply to builds. Development and Node-based tests retain their
normal dependency resolution.

The built server still uses `node:async_hooks`, which the Convex runtime supports.
The plugin does not make arbitrary Node-only dependencies compatible with Convex.
Use it with the supplied server entry and do not add Node export conditions.

## Scope

Verified with Convex 1.45.0, Static Hosting 0.2.1, TanStack Start 1.168.34,
TanStack Router 1.170.18, React 19.2.6, and the repository's Vite+ 0.2.7.
Peer versions intentionally match the experiment until newer versions are tested.
The package exports TypeScript source for workspace bundlers and is not published.

Public pages, loader data, hydration, navigation, and live Convex queries were
tested on a hosted Convex development deployment. Streaming, personalized SSR,
and TanStack server functions are outside the verified scope. Keep Convex clients
scoped to each request when adding server authentication.

The integration has no persistent state, so a regular package is sufficient.
A future component could own an HTML cache or deployment metadata if those become
requirements. Static Hosting already owns asset storage.

See the [experiment report](../../docs/convex-ssr-experiment.md) for the Scout
preview, reproduction commands, and hosted evidence.
