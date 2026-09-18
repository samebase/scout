import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import { components } from "./_generated/api";
import { auth } from "./auth";
import { handlePolarEvent } from "./polar";
// oxlint-disable-next-line no-restricted-imports -- This HTTP boundary authenticates Polar's signature.
import { httpAction } from "./_generated/server";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: "/polar/events", method: "POST", handler: httpAction(handlePolarEvent) });
registerStaticRoutes(http, components.staticHosting, {
  spaFallback: true,
});

export default http;
