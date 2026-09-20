import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import typegpu from "unplugin-typegpu/vite";
import { defineConfig } from "vite-plus";
import { convexSsr } from "@samebase/convex-tanstack-start/vite";
import { resolveWorktreeKind } from "./scripts/run-context-dev.ts";
import { prerenderPages, prerenderPathRewrites } from "./prerender.config.ts";

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
        spa: {
          enabled: true,
          // The hash keeps the shell on the public root route while giving
          // prerendering a distinct key from the actual homepage.
          maskPath: "/#__spa-shell",
          prerender: {
            outputPath: "/index.html",
          },
        },
      }),
      {
        name: "public-page-rewrites",
        apply: "build",
        applyToEnvironment: (environment) => environment.name === "client",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "_redirects",
            source: [
              ...prerenderPages.map(({ path, prerender }) => `${prerender.outputPath} ${path} 301`),
              ...Array.from(prerenderPathRewrites, ([path, htmlPath]) => `${path} ${htmlPath} 200`),
              "",
            ].join("\n"),
          });
        },
      },
      react(),
    ],
    test: {
      name: "scout",
      // Give renderer mocks a resolvable entry before the first build.
      alias: {
        "../dist/server/server.js": fileURLToPath(new URL("./src/server.ts", import.meta.url)),
      },
      // Keep hoisted dependencies inside the test root. Vitest's /@fs/ loader
      // reads global process while Convex Workflow temporarily removes it.
      root: fileURLToPath(new URL("../..", import.meta.url)),
      include: ["apps/scout/**/*.test.{ts,tsx}"],
    },
  };
});
