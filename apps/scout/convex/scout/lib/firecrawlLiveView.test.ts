import { expect, test } from "vite-plus/test";
import { requireFirecrawlLiveViewUrl } from "./firecrawlLiveView";

test.each([
  "https://liveview.firecrawl.dev/session?token=signed%2Bvalue&viewOnly=true",
  "https://hangar.firecrawl.dev/session?token=signed%2Bvalue&viewOnly=true",
  "https://browser.provider.test:8443/session?token=signed%2Bvalue&viewOnly=true",
])("accepts the provider's HTTPS live view URL %s", (url) => {
  expect(requireFirecrawlLiveViewUrl(url)).toBe(url);
});

test.each([
  null,
  42,
  "",
  "not a URL",
  "//hangar.firecrawl.dev/session",
  "http://hangar.firecrawl.dev/session",
  "javascript:alert(1)",
  "data:text/html,<p>session</p>",
])("rejects malformed or non-HTTPS live view URL %s", (url) => {
  expect(() => requireFirecrawlLiveViewUrl(url)).toThrow(
    "Firecrawl returned an invalid live view URL",
  );
});
