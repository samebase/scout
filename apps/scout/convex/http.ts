import { httpRouter } from "convex/server";
import { routeAll } from "@samebase/convex-hosting";
import { components } from "./_generated/api";
import { handlePolarEvent } from "./polar";
import { assets } from "../.convex-hosting/version.js";
// Type only, nothing is bundled: the type of the server build imported below, so this file
// typechecks before the first build.
import type {} from "@samebase/convex-hosting-tanstack-start/server-build";
import server from "../dist/server/server.js";
// oxlint-disable-next-line no-restricted-imports -- Protocol boundaries for the site and the signed Polar webhook.
import { env, httpAction } from "./_generated/server";

const http = httpRouter();

http.route({ path: "/polar/events", method: "POST", handler: httpAction(handlePolarEvent) });

// The Client ID Metadata Document of this deployment: its address is the client id at
// login.samebase.com. An exact path, so it wins over the site's "/" prefix below.
http.route({
  path: "/oauth-client.json",
  method: "GET",
  handler: httpAction(async () =>
    Response.json({
      client_id: env.OAUTH_CLIENT_ID,
      client_name: "TrailScout",
      redirect_uris: [`${env.CONVEX_SITE_URL}/auth/hub/callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  ),
});

// Every method, every path, as a Cloudflare Worker with static assets: the uploaded file for a path
// that has one (another method than GET or HEAD on it answers 405), else the server build
// (src/server.ts), which renders the page with the session of the request's cookies. Convex answers
// HEAD through GET. Convex picks an exact path, then the longest prefix, so the Polar webhook, the
// Convex Auth component's /auth prefix, where it serves its key set, and the identity broker
// component's /auth/hub prefix, where the broker returns to /auth/hub/callback, keep winning over "/".
const site = routeAll({ http, component: components.hosting, assets, worker: server });
// Exact routes for the three session routes of src/server.ts: the /auth prefix of the component
// would otherwise take them.
for (const path of ["/auth/signin", "/auth/refresh", "/auth/signout"]) {
  http.route({ path, method: "POST", handler: site });
}

export default http;
