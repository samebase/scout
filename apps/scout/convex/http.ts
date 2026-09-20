import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { auth } from "./auth";
import { handlePolarEvent } from "./polar";
import { rewritePrerenderPath } from "../prerender.config";
// oxlint-disable-next-line no-restricted-imports -- Protocol boundaries for the public homepage and signed Polar webhook.
import { env, httpAction } from "./_generated/server";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    let response: Response;
    if (env.HOMEPAGE_SSR_ENABLED === "true") {
      const { default: app } = await import("../dist/server/server.js");
      response = await app.fetch(request);
    } else {
      const path = new URL(request.url).search ? "/index.html" : "/_landing.html";
      const staticPage = await fetch(new URL(path, env.CONVEX_SITE_URL));
      response = new Response(staticPage.body, {
        status: staticPage.status,
        statusText: staticPage.statusText,
        headers: staticPage.headers,
      });
    }
    response.headers.set("Cache-Control", "no-store");
    return response;
  }),
});
http.route({ path: "/polar/events", method: "POST", handler: httpAction(handlePolarEvent) });
registerStaticRoutes(http, components.staticHosting, {
  spaFallback: true,
  rewritePath: rewritePrerenderPath,
});

export default http;
