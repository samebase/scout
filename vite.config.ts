import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["**/.agents/**", "**/convex/**/_generated/**", "**/src/routeTree.gen.ts"],
  },
  lint: {
    ignorePatterns: ["**/.agents/**", "**/convex/**/_generated/**", "**/src/routeTree.gen.ts"],
    overrides: [
      {
        files: ["apps/scout/convex/components/**/*.ts"],
        // Component exports are internal to the app and use their own generated builders.
        rules: { "no-restricted-imports": "off" },
      },
    ],
    options: { typeAware: true },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/_generated/server", "**/_generated/server.*"],
              importNames: ["query", "mutation", "action", "httpAction", "*"],
              message:
                "Declare public application policies through convex/functions.ts. Keep raw builders at protocol boundaries.",
            },
            {
              group: ["convex/server"],
              importNames: [
                "queryGeneric",
                "mutationGeneric",
                "actionGeneric",
                "httpActionGeneric",
              ],
              message: "Use the application permission builders in convex/functions.ts.",
            },
            {
              group: ["convex-helpers/server/customFunctions"],
              importNames: ["customQuery", "customMutation", "customAction"],
              message: "Define public permission builders only in convex/functions.ts.",
            },
          ],
        },
      ],
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

  staged: { "*": "vp check --fix" },
  test: {
    projects: [
      { test: { name: "tooling", include: ["scripts/**/*.test.ts"] } },
      "apps/*",
      "packages/*",
    ],
  },
});
