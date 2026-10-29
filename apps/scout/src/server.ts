import { httpCookies, ServerAuthSession, setupConvexAuthServer } from "@convex-dev/auth/ssr";
import handler from "@samebase/convex-hosting-tanstack-start/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const convexUrl: string = import.meta.env["VITE_CONVEX_URL"];
const convex = new ConvexHttpClient(convexUrl);

// Answers every request that no file and no other route of convex/http.ts answers: on Convex,
// convex/http.ts calls it; in development and in `vp preview`, Vite does.
const server = {
  async fetch(request: Request) {
    const url = new URL(request.url);
    // `Secure` when the browser reached the site over HTTPS. Vite's dev server serves plain HTTP,
    // so the request decides, not the build or the backend URL.
    const cookieOptions = { secure: url.protocol === "https:" };
    if (request.method === "POST") {
      // The browser signs in, refreshes, and signs out through these routes, and the refresh token
      // stays in an httpOnly cookie on this origin. Every mutation that mints a session is listed in
      // `signIn`; the route answers 403 for any other function.
      const auth = setupConvexAuthServer({
        convexUrl,
        refreshSession: api.auth.refreshSession,
        signOut: api.auth.signOut,
        signIn: [
          api.auth.signInWithEmailPassword,
          api.auth.completeSignUp,
          api.auth.completePasswordRecovery,
          api.auth.completeSignInWithHub,
        ],
        cookieOptions,
      });
      switch (url.pathname) {
        case "/auth/signin":
          return auth.convexProxyHandler(request);
        case "/auth/refresh":
          return auth.refreshHandler(request);
        case "/auth/signout":
          return auth.signOutHandler(request);
      }
    }

    const cookies = httpCookies(request);
    const session = new ServerAuthSession({
      refreshSession: (refreshToken) => convex.mutation(api.auth.refreshSession, { refreshToken }),
      cookies,
      cookieOptions,
    });
    // The build's prerender renders the public pages without a visitor, and every visitor gets
    // them: vite.config.ts marks its requests, and they get no token at all.
    const token = request.headers.has("x-prerender") ? undefined : await session.getToken();
    const page = await handler.fetch(request, { context: { token } });
    // A refresh spends the refresh token of the cookie, so the page answer carries the rotated
    // cookies.
    const headers = new Headers(page.headers);
    cookies.applyTo(headers);
    return new Response(page.body, { status: page.status, headers });
  },
};

export default server;
