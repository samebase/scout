// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { ReplayTimeline } from "../lib/browserReplayTimeline";
import { BrowserReplayHeader } from "./browser-replay-header";

afterEach(cleanup);

const pages: ReplayTimeline["pages"] = [
  {
    pageId: "home",
    pageUrl: "https://example.com/",
    startTimeMs: 0,
    endTimeMs: 1000,
    relativeStartMs: 0,
    relativeEndMs: 1000,
    binding: { kind: "unmatched" },
    urlHistory: [],
  },
  {
    pageId: "docs",
    pageUrl: "https://example.com/docs",
    startTimeMs: 0,
    endTimeMs: 1000,
    relativeStartMs: 0,
    relativeEndMs: 1000,
    binding: { kind: "unmatched" },
    urlHistory: [],
  },
];

test.each([
  ["home", "example.com", "https://example.com/"],
  ["docs", "example.com/docs", "https://example.com/docs"],
])(
  "selects %s manually and restores following with accurate pressed states",
  (pageId, label, url) => {
    const onSelectPage = vi.fn();
    const { rerender } = render(
      <BrowserReplayHeader
        pages={pages}
        currentTimeMs={500}
        activePageId="home"
        following
        onSelectPage={onSelectPage}
      />,
    );
    const following = screen.getByRole("button", { name: "Following Scout", pressed: true });
    expect(following.textContent).toBe("Following Scout");
    expect(following.getAttribute("title")).toBe(
      "Automatically switch to Scout's recorded active tab. Select a tab to view it manually.",
    );
    const tabs = screen.getByRole("group", { name: "Recorded tabs" });
    const selectedTab = within(tabs).getByRole("button", { name: label });
    expect(selectedTab.getAttribute("title")).toContain("manually");
    fireEvent.click(selectedTab);
    expect(onSelectPage).toHaveBeenCalledExactlyOnceWith(pageId);

    rerender(
      <BrowserReplayHeader
        pages={pages}
        currentTimeMs={500}
        activePageId={pageId}
        following={false}
        onSelectPage={onSelectPage}
      />,
    );
    expect(within(tabs).getByRole("button", { name: label, pressed: true })).toBe(selectedTab);
    expect(within(tabs).getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Recorded URL" })).toHaveProperty("value", url);
    const follow = screen.getByRole("button", { name: "Follow Scout", pressed: false });
    expect(follow.textContent).toBe("Follow Scout");
    fireEvent.click(follow);
    expect(onSelectPage).toHaveBeenLastCalledWith(null);
    expect(onSelectPage).toHaveBeenCalledTimes(2);

    rerender(
      <BrowserReplayHeader
        pages={pages}
        currentTimeMs={500}
        activePageId="home"
        following
        onSelectPage={onSelectPage}
      />,
    );
    expect(screen.getByRole("button", { name: "Following Scout", pressed: true })).toBe(follow);
    expect(within(tabs).getByRole("button", { name: "example.com", pressed: true })).toBeTruthy();
  },
);
