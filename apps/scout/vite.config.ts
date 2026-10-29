import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import typegpu from "unplugin-typegpu/vite";
import { defineConfig, type Plugin } from "vite-plus";
import { convexAuth } from "@samebase/convex-auth-tanstack-start/vite";
import { convexSsr } from "@samebase/convex-hosting-tanstack-start/vite";
import { resolveWorktreeKind } from "./scripts/run-context-dev.ts";

// Data pages render per request. Only data-free pages prerender, so builds can run before a new
// deployment's backend exists.
const prerenderPages = [
  { path: "/about", prerender: { outputPath: "/about/index.html" } },
  { path: "/privacy", prerender: { outputPath: "/privacy/index.html" } },
  { path: "/terms", prerender: { outputPath: "/terms/index.html" } },
];

/**
The Convex CLI bundles the argon2 WASM module of the Convex Auth password component as a
`WebAssembly.Module`. The Convex tests load the same component source, so Vitest loads the module
the same way.
*/
function wasmModule(): Plugin {
  return {
    name: "wasm-as-webassembly-module",
    enforce: "pre",
    load(id) {
      if (!id.endsWith(".wasm")) return null;
      const base64 = readFileSync(id).toString("base64");
      return `export default new WebAssembly.Module(Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0)));`;
    },
  };
}

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
      convexAuth(),
      typegpu(),
      tailwindcss(),
      tanstackStart({
        pages: prerenderPages,
        prerender: {
          enabled: true,
          // Every visitor gets a prerendered page, so src/server.ts gives a request with this header
          // no session at all, rather than a signed-out one.
          headers: { "x-prerender": "1" },
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
      wasmModule(),
    ],
    test: {
      name: "scout",
      // Keep hoisted dependencies inside the test root. Vitest's /@fs/ loader
      // reads global process while Convex Workflow temporarily removes it.
      root: fileURLToPath(new URL("../..", import.meta.url)),
      include: ["apps/scout/**/*.test.{ts,tsx}"],
      // Inlined dependencies go through Vite: renderer tests mock TanStack Start's server module,
      // which reaches the published server entry only then; convexAuth() resolves the session
      // package's import of Convex Auth's provider file; and argon2id-wasm's WASM import goes through
      // the plugin above, where Node cannot import a .wasm file.
      server: {
        deps: {
          inline: [
            "@samebase/convex-hosting-tanstack-start",
            "@samebase/convex-auth-tanstack-start",
            "argon2id-wasm",
          ],
        },
      },
    },
  };
});
