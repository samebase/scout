import { httpRouter } from "convex/server";
// oxlint-disable-next-line no-restricted-imports -- Public HTML is the HTTP protocol boundary.
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import app from "../dist/server/server.js";

const http = httpRouter();
const render = httpAction(async (_ctx, request) => {
  const response: Response = await app.fetch(request);
  response.headers.set("Cache-Control", "no-store");
  return response;
});

http.route({ path: "/", method: "GET", handler: render });
http.route({ path: "/about", method: "GET", handler: render });
registerStaticRoutes(http, components.staticHosting, { spaFallback: false });

export default http;
