import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  ssr: {
    // The published sidebar package imports its structural CSS from its JS
    // entrypoint. Bundle it for SSR so Vite handles that import instead of
    // leaving Node to load the CSS file directly.
    noExternal: ["@samebase/sidebars"],
  },
  fmt: {
    ignorePatterns: [".agents/**", "convex/_generated/**", "src/routeTree.gen.ts"],
  },
  lint: {
    ignorePatterns: [".agents/**", "convex/_generated/**", "src/routeTree.gen.ts"],
    options: { typeAware: true },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      prerender: {
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
      },
      spa: {
        enabled: true,
        // Both static hosts serve this shell for app routes. Render it from
        // /chats so the root redirect is not part of shell generation.
        maskPath: "/chats",
        prerender: {
          outputPath: "/index.html",
        },
      },
    }),
    react(),
  ],
  staged: {
    "*": "vp check --fix",
  },
});
