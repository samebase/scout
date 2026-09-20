import { createStartHandler, StartServer } from "@tanstack/react-start/server";
import { renderSsrHtmlResponse } from "@tanstack/react-router/ssr/server";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";

// Convex omits size, which TanStack uses when normalizing query-string URLs.
if (new URLSearchParams().size === undefined) {
  Object.defineProperty(URLSearchParams.prototype, "size", {
    configurable: true,
    get(this: URLSearchParams) {
      return Array.from(this).length;
    },
  });
}

export default {
  fetch: createStartHandler((context) => {
    const { router, responseHeaders, request } = context;
    return renderSsrHtmlResponse({
      router,
      responseHeaders,
      render: async () => {
        // Await Suspense with React's Web Stream renderer. TanStack's stream
        // handler also imports node:stream, which Convex cannot bundle.
        const stream = await renderToReadableStream(createElement(StartServer, { router }), {
          signal: request.signal,
          ...(router.options.ssr?.nonce === undefined ? {} : { nonce: router.options.ssr.nonce }),
        });
        await stream.allReady;
        return new Response(stream).text();
      },
    });
  }),
};
