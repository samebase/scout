import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vite-plus/test";
import { unstable_readConfig } from "wrangler";

const configuration = vi.hoisted(() => ({
  tanstackStart: vi.fn((_options: unknown) => [{ name: "start-config-test" }]),
}));

vi.mock("@tanstack/react-start/plugin/vite", () => ({
  tanstackStart: configuration.tanstackStart,
}));

import viteConfig from "../vite.config.ts";

describe("Static hosting", () => {
  test("builds one SPA shell from the public landing page", () => {
    viteConfig({ command: "build", mode: "production" });
    expect(configuration.tanstackStart).toHaveBeenCalledExactlyOnceWith({
      prerender: {
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
      },
      spa: {
        enabled: true,
        maskPath: "/",
        prerender: { outputPath: "/index.html" },
      },
    });
  });

  test("uses Cloudflare SPA fallback without HTML-path canonicalization", () => {
    const worker = unstable_readConfig({
      config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
    });
    expect(worker.assets?.not_found_handling).toBe("single-page-application");
    expect(worker.assets?.html_handling).toBe("none");
  });
});
