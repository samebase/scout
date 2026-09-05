import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
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
    fmt: {
      ignorePatterns: [".agents/**", "convex/_generated/**", "src/routeTree.gen.ts"],
    },
    lint: {
      ignorePatterns: [".agents/**", "convex/_generated/**", "src/routeTree.gen.ts"],
      options: { typeAware: true },
      rules: {
        "@typescript-eslint/ban-ts-comment": [
          "error",
          {
            "ts-expect-error": "allow-with-description",
            "ts-ignore": true,
            "ts-nocheck": true,
            minimumDescriptionLength: 3,
          },
        ],
        "@typescript-eslint/await-thenable": "error",
        "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
        "@typescript-eslint/no-base-to-string": "error",
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": "error",
        "@typescript-eslint/no-unnecessary-type-assertion": "error",
        "@typescript-eslint/no-unsafe-enum-comparison": "error",
        "@typescript-eslint/restrict-plus-operands": "error",
        "@typescript-eslint/restrict-template-expressions": "error",
        "@typescript-eslint/unbound-method": "error",
        "no-restricted-globals": [
          "error",
          {
            name: "Reflect",
            message: "Use direct typed access or a schema-backed boundary adapter.",
          },
        ],
        "react-hooks/exhaustive-deps": "error",
      },
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
  };
});
