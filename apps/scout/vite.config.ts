import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import typegpu from "unplugin-typegpu/vite";
import { defineConfig } from "vite-plus";
import { resolveWorktreeKind } from "./scripts/run-context-dev.ts";

export default defineConfig(({ command }) => {
  const primaryCheckout = command === "serve" && resolveWorktreeKind() === "main";
  return {
    server: {
      port: primaryCheckout ? 5173 : 5174,
      strictPort: primaryCheckout,
    },
    ssr: {
      // The published sidebar package imports its structural CSS from its JS
      // entrypoint. Bundle it for SSR so Vite handles that import instead of
      // leaving Node to load the CSS file directly.
      noExternal: ["@samebase/sidebars"],
    },
    plugins: [
      typegpu(),
      tailwindcss(),
      tanstackStart({
        prerender: {
          autoStaticPathsDiscovery: false,
          crawlLinks: false,
        },
        spa: {
          enabled: true,
          // Both static hosts serve this shell for the landing and app routes.
          maskPath: "/",
          prerender: {
            outputPath: "/index.html",
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
    },
  };
});
