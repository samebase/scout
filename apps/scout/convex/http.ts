import { decodeRequestPath, serveStaticAsset } from "@samebase/convex-hosting";
import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { auth } from "./auth";
import { handlePolarEvent } from "./polar";
import { rewritePrerenderPath } from "../prerender.config";
import clientBuild from "../dist/server/client-build.json";
// oxlint-disable-next-line no-restricted-imports -- Protocol boundaries for public documents and the signed Polar webhook.
import { env, httpAction, type ActionCtx } from "./_generated/server";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: "/polar/events", method: "POST", handler: httpAction(handlePolarEvent) });
http.route({
  path: "/__convex_build",
  method: "GET",
  handler: httpAction(async () =>
    Response.json(clientBuild, { headers: { "Cache-Control": "no-store" } }),
  ),
});

// HTML can change with every deployment and with server rendering, so no cache may keep it.
function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function plainText(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

// TanStack Start renders a page only after this build's client files are published, so its HTML
// never refers to scripts that are not uploaded yet.
async function renderPage(ctx: ActionCtx, request: Request): Promise<Response | null> {
  if (env.TANSTACK_SERVER_ENABLED !== "true") return null;
  const marker = await ctx.runQuery(components.staticHosting.lib.resolveAssetForHttp, {
    path: clientBuild.markerPath,
    spaFallback: false,
  });
  if (!marker) return null;
  const { default: app } = await import("../dist/server/server.js");
  return withNoStore(await app.fetch(request));
}

// Uploaded files come first. A missing bundled file stays a 404. Every other path goes to
// TanStack Start when it is on, then to a prerendered page, then to the app shell.
http.route({
  pathPrefix: "/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const path = decodeRequestPath(new URL(request.url).pathname);
    if (path === null) return plainText("Bad Request", 400);

    const file = await serveStaticAsset(ctx, components.staticHosting, request, { path });
    if (file) {
      const isHtml =
        path.endsWith(".html") || file.headers.get("Content-Type")?.startsWith("text/html");
      return isHtml ? withNoStore(file) : file;
    }
    if (path.startsWith("/assets/")) return plainText("Not Found", 404);

    const rendered = await renderPage(ctx, request);
    if (rendered) return rendered;

    const pagePath = rewritePrerenderPath(path);
    const page =
      (pagePath === "/"
        ? null
        : await serveStaticAsset(ctx, components.staticHosting, request, { path: pagePath })) ??
      (await serveStaticAsset(ctx, components.staticHosting, request, { path: "/index.html" }));
    if (page) return withNoStore(page);
    // Without an uploaded shell, nothing is deployed yet.
    return path === "/" ? plainText("Not deployed yet", 503) : plainText("Not Found", 404);
  }),
});

export default http;
