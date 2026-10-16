import { httpRouter } from "convex/server";
import { serveSite } from "@samebase/convex-hosting";
import { components } from "./_generated/api";
import { auth } from "./auth";
import { handlePolarEvent } from "./polar";
import { versionId } from "../.convex-hosting/version.js";
// Type only, nothing is bundled: the type of the server build imported below, so this file
// typechecks before the first build.
import type {} from "@samebase/convex-hosting-tanstack-start/server-build";
import server from "../dist/server/server.js";
// oxlint-disable-next-line no-restricted-imports -- Protocol boundaries for the site and the signed Polar webhook.
import { httpAction } from "./_generated/server";

const http = httpRouter();
const toServer = httpAction((_ctx, request) => server.fetch(request));

auth.addHttpRoutes(http);
http.route({ path: "/polar/events", method: "POST", handler: httpAction(handlePolarEvent) });

// Every request that is not a GET goes to the app's server, as every request that is not a GET or
// HEAD goes to a Cloudflare Worker. Convex answers HEAD through GET. Convex picks an exact path,
// then the longest prefix, so the auth routes and the Polar webhook keep winning over "/".
for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
  http.route({ pathPrefix: "/", method, handler: toServer });
}

// The built site: the uploaded file for a path that has one, else the page that TanStack Start
// renders, signed out, because Convex Auth keeps the session in the browser.
http.route({
  pathPrefix: "/",
  method: "GET",
  handler: httpAction((ctx, request) =>
    serveSite(ctx, components.hosting, request, versionId, () => server.fetch(request)),
  ),
});

export default http;
