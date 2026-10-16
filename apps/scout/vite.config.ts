import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import typegpu from "unplugin-typegpu/vite";
import { defineConfig } from "vite-plus";
import { convexSsr } from "@samebase/convex-hosting-tanstack-start/vite";
import { resolveWorktreeKind } from "./scripts/run-context-dev.ts";
import { prerenderPages } from "./prerender.config.ts";

export default defineConfig(({ command }) => {
  const primaryCheckout = command === "serve" && resolveWorktreeKind() === "main";
  return {
    server: {
      port: primaryCheckout ? 5173 : 5174,
      strictPort: primaryCheckout,
    },
    ssr: { noExternal: ["@samebase/sidebars"] },
    plugins: [
      convexSsr(),
      typegpu(),
      tailwindcss(),
      tanstackStart({
        pages: prerenderPages,
        prerender: {
          enabled: true,
          autoStaticPathsDiscovery: false,
          crawlLinks: false,
          failOnError: true,
          onSuccess({ page, html }) {
            if (!prerenderPages.some(({ path }) => path === page.path)) return;
            if (!/<h1[\s>]/.test(html) || html.includes("Loading account"))
              throw new Error(`Public page ${page.path} did not prerender its content.`);
          },
        },
      }),
      react(),
    ],
    test: {
      name: "scout",
      // Keep hoisted dependencies inside the test root. Vitest's /@fs/ loader
      // reads global process while Convex Workflow temporarily removes it.
      root: fileURLToPath(new URL("../..", import.meta.url)),
      include: ["apps/scout/**/*.test.{ts,tsx}"],
      // Renderer tests mock TanStack Start's server module. Mocks reach a dependency only when
      // Vitest transforms it, so the published server entry is inlined.
      server: { deps: { inline: ["@samebase/convex-hosting-tanstack-start"] } },
    },
  };
});
