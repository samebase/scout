// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { PaginatedQueryArgs, UsePaginatedQueryReturnType } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { reviewFeedSearch } from "../lib/reviewFeedSearch";
import { ActivityFeed, SiteTaskList } from "./activity-feed";

type Sites = UsePaginatedQueryReturnType<typeof api.scout.sites.list>;
type Tasks = UsePaginatedQueryReturnType<typeof api.scout.activity.list>;
type Activity = Tasks["results"][number];

const remote = vi.hoisted(() => ({
  paginated: vi.fn(),
  loadSites: vi.fn<(count: number) => void>(),
  loadChessTasks: vi.fn<(count: number) => void>(),
  loadPaperTasks: vi.fn<(count: number) => void>(),
  loadUnassigned: vi.fn<(count: number) => void>(),
  tasks: new Map<string, Tasks>(),
  sites: new Array<Sites["results"][number]>(),
}));

vi.mock("../lib/access", () => ({
  useViewerAccess: () => ({ kind: "account", accessKeys: [] }),
}));
vi.mock("./site-preview", () => ({
  SitePreview: () => <div data-testid="site-preview" />,
}));
vi.mock("convex/react", () => ({
  usePaginatedQuery: (
    reference: FunctionReference<"query">,
    args:
      | PaginatedQueryArgs<typeof api.scout.sites.list>
      | PaginatedQueryArgs<typeof api.scout.activity.unassigned>,
    options: { initialNumItems: number },
  ): Sites | Tasks => {
    const name = getFunctionName(reference);
    remote.paginated(name, args, options);
    switch (name) {
      case "scout/sites:list":
        return {
          results: remote.sites,
          status: "CanLoadMore",
          isLoading: false,
          loadMore: remote.loadSites,
        };
      case "scout/activity:list": {
        if (!("site" in args) || args.site === null)
          throw new Error("Expected a site for the task query");
        const tasks = remote.tasks.get(args.site);
        if (!tasks) throw new Error(`Unexpected task query for ${args.site}`);
        return tasks;
      }
      case "scout/activity:unassigned":
        return {
          results: [],
          status: "Exhausted",
          isLoading: false,
          loadMore: remote.loadUnassigned,
        };
      default:
        throw new Error(`Unexpected paginated query: ${name}`);
    }
  },
}));

const observers: TestIntersectionObserver[] = [];

class TestIntersectionObserver implements IntersectionObserver {
  readonly root;
  readonly rootMargin;
  readonly scrollMargin;
  readonly thresholds;
  readonly targets = new Set<Element>();
  readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    this.scrollMargin = options.scrollMargin ?? "0px";
    this.thresholds =
      typeof options.threshold === "number" ? [options.threshold] : (options.threshold ?? [0]);
    observers.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  intersect(isIntersecting: boolean) {
    const entries = [...this.targets].map(
      (target): IntersectionObserverEntry => ({
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRect: isIntersecting ? target.getBoundingClientRect() : new DOMRect(),
        rootBounds: null,
        time: performance.now(),
      }),
    );
    if (entries.length) this.callback(entries, this);
  }
}

function task(site: string, number: number): Activity {
  return {
    threadId: `${site}-${number}`,
    title: `${site} task ${number}`,
    primarySite: site,
    createdAt: number,
    purpose: { kind: "review" },
    visibility: "public",
    status: "finished",
    scout: {
      // @ts-expect-error The mocked Convex transport uses a stable string instead of a database-generated scout ID.
      _id: "scout-fixture",
      displayName: "Scout",
      status: "active",
    },
    latestSession: null,
    walkthrough: null,
  };
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  remote.sites = [
    {
      hostname: "chessmerge.com",
      taskCount: 7,
      preview: null,
      profile: { name: "Chess Merge", homepageUrl: "https://chessmerge.com", researchedAt: 1000 },
      research: { status: "completed", error: null },
    },
    {
      hostname: "papergames.io",
      taskCount: 3,
      preview: null,
      profile: null,
      research: { status: "running", error: null },
    },
  ];
  remote.tasks.set("chessmerge.com", {
    results: [task("chessmerge.com", 1), task("chessmerge.com", 2)],
    status: "CanLoadMore",
    isLoading: false,
    loadMore: remote.loadChessTasks,
  });
  remote.tasks.set("papergames.io", {
    results: [task("papergames.io", 1), task("papergames.io", 2)],
    status: "CanLoadMore",
    isLoading: false,
    loadMore: remote.loadPaperTasks,
  });
});

afterEach(() => {
  cleanup();
  observers.length = 0;
  remote.tasks.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function openFeed(path = "/") {
  const root = createRootRoute({ staticData: { access: "access_public" }, component: Outlet });
  const home = createRoute({
    path: "/",
    getParentRoute: () => root,
    staticData: { access: "access_public" },
    validateSearch: reviewFeedSearch,
    component: () => <ActivityFeed search={home.useSearch()} />,
  });
  const detail = createRoute({
    path: "/sites/$site",
    getParentRoute: () => root,
    staticData: { access: "access_public" },
    validateSearch: reviewFeedSearch.pick({ scope: true }),
    component: () => (
      <>
        <h1>{detail.useParams().site}</h1>
        <SiteTaskList site={detail.useParams().site} scope={detail.useSearch().scope ?? "public"} />
      </>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([home, detail]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  await screen.findByRole("article", { name: "chessmerge.com" });
  return router;
}

test("requests six sites initially and two tasks for each site", async () => {
  await openFeed();

  expect(remote.paginated).toHaveBeenCalledWith(
    "scout/sites:list",
    { site: null, scope: "public" },
    { initialNumItems: 6 },
  );
  for (const site of ["chessmerge.com", "papergames.io"]) {
    expect(remote.paginated).toHaveBeenCalledWith(
      "scout/activity:list",
      { site, scope: "public" },
      { initialNumItems: 2 },
    );
    const card = within(screen.getByRole("article", { name: site }));
    expect(card.getByRole("heading", { name: `${site} task 1`, level: 3 })).toBeTruthy();
    expect(card.getByRole("heading", { name: `${site} task 2`, level: 3 })).toBeTruthy();
    expect(
      card.getByRole("link", {
        name: site === "chessmerge.com" ? "View all 7 tasks" : "View all 3 tasks",
      }),
    ).toBeTruthy();
  }
  expect(remote.loadSites).not.toHaveBeenCalled();
  expect(remote.loadChessTasks).not.toHaveBeenCalled();
  expect(remote.loadPaperTasks).not.toHaveBeenCalled();
});

test("a site with one task uses a singular link", async () => {
  remote.sites[0].taskCount = 1;
  await openFeed();
  const card = within(screen.getByRole("article", { name: "chessmerge.com" }));
  expect(card.getByRole("link", { name: "View 1 task" })).toBeTruthy();
});

test.each(["public", "mine"])(
  "View all tasks opens the site's task page and preserves the %s scope",
  async (scope) => {
    const router = await openFeed(`/?scope=${scope}`);
    const user = userEvent.setup();
    const card = within(screen.getByRole("article", { name: "chessmerge.com" }));
    const link = card.getByRole("link", { name: "View all 7 tasks" });
    expect(link.getAttribute("href")).toBe(`/sites/chessmerge.com?scope=${scope}`);
    expect(card.queryByRole("button", { name: "Show more tasks" })).toBeNull();
    await user.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe("/sites/chessmerge.com"));
    expect(router.state.location.search).toEqual({ scope });
    expect(await screen.findByRole("region", { name: "Tasks for chessmerge.com" })).toBeTruthy();
    expect(remote.paginated).toHaveBeenCalledWith(
      "scout/activity:list",
      { site: "chessmerge.com", scope },
      { initialNumItems: 10 },
    );
    expect(remote.loadChessTasks).not.toHaveBeenCalled();
    expect(remote.loadPaperTasks).not.toHaveBeenCalled();
    expect(remote.loadSites).not.toHaveBeenCalled();
  },
);

test("loads the next six sites when the sentinel intersects, without a More sites button", async () => {
  await openFeed();
  expect(screen.queryByRole("button", { name: /more sites/i })).toBeNull();

  const sentinels = observers.filter((observer) =>
    [...observer.targets].some((target) => !target.closest("article")),
  );
  expect(sentinels).toHaveLength(1);
  const sentinel = sentinels[0];
  act(() => sentinel.intersect(false));
  expect(remote.loadSites).not.toHaveBeenCalled();

  act(() => sentinel.intersect(true));
  expect(remote.loadSites).toHaveBeenCalledExactlyOnceWith(6);
  expect(remote.loadChessTasks).not.toHaveBeenCalled();
  expect(remote.loadPaperTasks).not.toHaveBeenCalled();

  act(() => sentinel.intersect(true));
  expect(remote.loadSites).toHaveBeenCalledTimes(1);
});

test.each(["public", "mine"])("site heading links preserve the %s scope", async (scope) => {
  const router = await openFeed(`/?scope=${scope}`);
  const user = userEvent.setup();

  for (const site of ["chessmerge.com", "papergames.io"]) {
    const card = within(screen.getByRole("article", { name: site }));
    const link = card.getByRole("link", {
      name: site === "chessmerge.com" ? "Chess Merge chessmerge.com" : "papergames.io",
    });
    expect(link.getAttribute("href")).toBe(`/sites/${site}?scope=${scope}`);
    const previewLink = card.getByRole("link", {
      name: `View ${site === "chessmerge.com" ? "Chess Merge" : site} details`,
    });
    expect(previewLink.getAttribute("href")).toBe(link.getAttribute("href"));
    expect(within(previewLink).getByTestId("site-preview")).toBeTruthy();
    expect(
      within(link).getByRole("heading", {
        name: site === "chessmerge.com" ? "Chess Merge" : site,
        level: 2,
      }),
    ).toBeTruthy();
  }
  await user.click(screen.getByRole("link", { name: "papergames.io" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/sites/papergames.io"));
  expect(router.state.location.search).toEqual({ scope });
  expect(await screen.findByRole("region", { name: "Tasks for papergames.io" })).toBeTruthy();
  expect(screen.queryByTestId("site-preview")).toBeNull();
  expect(screen.queryByRole("button", { name: "Show more tasks" })).toBeNull();
  expect(screen.getByRole("link", { name: /papergames.io task 1/ }).getAttribute("href")).toContain(
    "/review?",
  );
});

test("site groups put the researched product name above its hostname", async () => {
  await openFeed();
  const card = within(screen.getByRole("article", { name: "chessmerge.com" }));
  const heading = card.getByRole("heading", { name: "Chess Merge", level: 2 });
  expect(heading.nextElementSibling?.textContent).toBe("chessmerge.com");
  expect(card.queryByText("Research completed")).toBeNull();
  const unnamed = within(screen.getByRole("article", { name: "papergames.io" }));
  expect(
    unnamed.getByRole("heading", { name: "papergames.io", level: 2 }).nextElementSibling,
  ).toBeNull();
});
