// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { FunctionReturnType } from "convex/server";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { SitePreview } from "./site-preview";

const useAction = vi.fn();
vi.mock("convex/react", () => ({ useAction: () => useAction() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("public previews have a usable image URL on the first render without a signing action", () => {
  const site: NonNullable<FunctionReturnType<typeof api.scout.sites.get>> = {
    hostname: "example.com",
    profile: null,
    research: null,
    preview: { kind: "public", capturedAt: 1, url: "https://media.example.test/preview.png" },
  };
  const { container, rerender } = render(<SitePreview site={site} />);
  const image = container.querySelector("img");
  expect(image?.getAttribute("src")).toBe("https://media.example.test/preview.png");
  expect(useAction).not.toHaveBeenCalled();
  if (!image) throw new Error("Preview did not render");
  fireEvent.error(image);
  expect(container.querySelector("img")).toBeNull();
  expect(useAction).not.toHaveBeenCalled();
  rerender(
    <SitePreview
      site={{
        ...site,
        preview: { kind: "public", capturedAt: 2, url: "https://media.example.test/new.png" },
      }}
    />,
  );
  expect(container.querySelector("img")?.getAttribute("src")).toBe(
    "https://media.example.test/new.png",
  );
});
