import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { auth } from "./auth";
import { handlePolarEvent } from "./polar";
import { rewritePrerenderPath } from "../prerender.config";
// oxlint-disable-next-line no-restricted-imports -- Protocol boundaries for public documents and the signed Polar webhook.
import { env, httpAction } from "./_generated/server";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: "/polar/events", method: "POST", handler: httpAction(handlePolarEvent) });
registerStaticRoutes(http, components.staticHosting, {
  spaFallback: true,
  rewritePath: rewritePrerenderPath,
  fallback: async (request) => {
    if (env.TANSTACK_SERVER_ENABLED !== "true") return null;
    const { default: app } = await import("../dist/server/server.js");
    const response = await app.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
});

export default http;
