import { createStartHandler, defaultRenderHandler } from "@tanstack/react-start/server";

// Convex omits size, which TanStack uses when normalizing query-string URLs.
if (new URLSearchParams().size === undefined) {
  Object.defineProperty(URLSearchParams.prototype, "size", {
    configurable: true,
    get(this: URLSearchParams) {
      return Array.from(this).length;
    },
  });
}

export default { fetch: createStartHandler(defaultRenderHandler) };
