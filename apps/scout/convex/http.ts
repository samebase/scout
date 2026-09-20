import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { auth } from "./auth";
import { handlePolarEvent } from "./polar";
import { rewritePrerenderPath } from "../prerender.config";
// oxlint-disable-next-line no-restricted-imports -- Protocol boundaries for the public homepage and signed Polar webhook.
import { httpAction } from "./_generated/server";
import app from "../dist/server/server.js";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const response: Response = await app.fetch(request);
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
