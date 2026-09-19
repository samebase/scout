// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import type { Id } from "../../convex/_generated/dataModel";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ScoutBrowserProfile } from "./scout-browser-profile";

const remote = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("convex/react", () => ({ useAction: () => remote.refresh }));

// @ts-expect-error Rendering fixture uses an opaque string in place of a database-issued Scout ID.
const scoutId: Id<"scouts"> = "scout-conrad";
const props = { scoutId, profileName: "scout-conrad" };

beforeEach(() => remote.refresh.mockReset().mockResolvedValue(null));
afterEach(() => cleanup());

it("does not inspect on render and distinguishes unchecked from an observed zero", () => {
  const view = render(
    <dl>
      <ScoutBrowserProfile {...props} summary={null} />
    </dl>,
  );
  expect(screen.getByText("Saved cookies not checked yet.")).toBeTruthy();
  expect(screen.queryByText("0 saved cookies · 0 domains")).toBeNull();
  expect(remote.refresh).not.toHaveBeenCalled();
  view.rerender(
    <dl>
      <ScoutBrowserProfile
        {...props}
        summary={{ cookieCount: 0, cookieDomainCount: 0, checkedAt: 1 }}
      />
    </dl>,
  );
  expect(screen.getByText("0 saved cookies · 0 domains")).toBeTruthy();
  expect(screen.queryByText("Saved cookies not checked yet.")).toBeNull();
});

it("keeps cached counts visible during refresh and shows the provider error", async () => {
  const rejectRefresh = vi.fn<(reason: unknown) => void>();
  remote.refresh.mockReturnValue(
    new Promise<null>((_resolve, reject) => {
      rejectRefresh.mockImplementation(reject);
    }),
  );
  const user = userEvent.setup();
  const view = render(
    <dl>
      <ScoutBrowserProfile
        {...props}
        summary={{ cookieCount: 427, cookieDomainCount: 40, checkedAt: 1 }}
      />
    </dl>,
  );
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  expect(remote.refresh).toHaveBeenCalledExactlyOnceWith({ scoutId });
  expect(screen.getByRole("button", { name: "Refreshing…" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("427 saved cookies · 40 domains")).toBeTruthy();
  rejectRefresh(new ConvexError("Firecrawl POST /v2/browser: Rate limit reached (HTTP 429)"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("HTTP 429"));
  expect(screen.getByText("427 saved cookies · 40 domains")).toBeTruthy();
  remote.refresh.mockResolvedValue(null);
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  view.rerender(
    <dl>
      <ScoutBrowserProfile
        {...props}
        summary={{ cookieCount: 428, cookieDomainCount: 41, checkedAt: 2 }}
      />
    </dl>,
  );
  expect(screen.getByText("428 saved cookies · 41 domains")).toBeTruthy();
});
