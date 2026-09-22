// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createControlledPromise,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { PaginatedQueryArgs, UsePaginatedQueryReturnType } from "convex/react";
import { Suspense, useSyncExternalStore } from "react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { reviewFeedSearch } from "../lib/reviewFeedSearch";
import { ActivityFeed, SiteTaskList } from "./activity-feed";
import { SiteSearchLoading } from "./site-search-results";
import { convexQuery } from "@convex-dev/react-query";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { z } from "zod";

type Sites = UsePaginatedQueryReturnType<typeof api.scout.sites.list>;
type Tasks = UsePaginatedQueryReturnType<typeof api.scout.activity.list>;
type Activity = Tasks["results"][number];

const remote = vi.hoisted(() => ({
  count:
    vi.fn<
      (scope: "public" | "mine") => FunctionReturnType<typeof api.scout.sites.count> | undefined
    >(),
  paginated: vi.fn(),
  loadSites: vi.fn<(count: number) => void>(),
  loadChessTasks: vi.fn<(count: number) => void>(),
  loadPaperTasks: vi.fn<(count: number) => void>(),
  loadUnassigned: vi.fn<(count: number) => void>(),
  tasks: new Map<string, Tasks>(),
  sites: new Array<Sites["results"][number]>(),
  sitePages: new Map<string, Sites>(),
  loadingSites: false,
  revision: 0,
  subscribe: (listener: () => void) => {
    remote.listeners.add(listener);
    return () => remote.listeners.delete(listener);
  },
  listeners: new Set<() => void>(),
  getSnapshot: () => remote.revision,
}));

vi.mock("../lib/access", () => ({
  useViewerAccess: () => ({ kind: "account", accessKeys: [] }),
}));
vi.mock("./site-preview", () => ({
  SitePreview: () => <div data-testid="site-preview" />,
}));
vi.mock("convex/react", () => ({
  useQuery: (
    reference: FunctionReference<"query">,
    args: FunctionArgs<typeof api.scout.sites.count>,
  ) => {
    useSyncExternalStore(remote.subscribe, remote.getSnapshot);
    const name = getFunctionName(reference);
    if (name !== "scout/sites:count") throw new Error(`Unexpected query: ${name}`);
    return remote.count(args.scope);
  },
  usePaginatedQuery: (
    reference: FunctionReference<"query">,
    args:
      | PaginatedQueryArgs<typeof api.scout.sites.list>
      | PaginatedQueryArgs<typeof api.scout.activity.unassigned>,
    options: { initialNumItems: number },
  ): Sites | Tasks => {
    useSyncExternalStore(remote.subscribe, remote.getSnapshot);
    const name = getFunctionName(reference);
    remote.paginated(name, args, options);
    switch (name) {
      case "scout/sites:list": {
        const page = remote.sitePages.get("site" in args ? (args.site ?? "") : "");
        if (page) return page;
        if (remote.loadingSites)
          return {
            results: [],
            status: "LoadingFirstPage",
            isLoading: true,
            loadMore: remote.loadSites,
          };
        return {
          results:
            "site" in args && args.site
              ? remote.sites.filter(
                  (site) =>
                    site.hostname.includes(args.site ?? "") ||
                    site.profile?.name.toLowerCase().includes(args.site ?? ""),
                )
              : remote.sites,
          status: "CanLoadMore",
          isLoading: false,
          loadMore: remote.loadSites,
        };
      }
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
const queryClients: QueryClient[] = [];

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
      slug: "scout",
      status: "active",
    },
    latestSession: null,
    walkthrough: null,
  };
}

beforeEach(() => {
  remote.loadingSites = false;
  remote.count.mockImplementation((scope) => ({
    count: scope === "public" ? 1000 : 1,
    hasMore: scope === "public",
  }));
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
  for (const client of queryClients) client.clear();
  queryClients.length = 0;
  observers.length = 0;
  remote.tasks.clear();
  remote.sitePages.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function createQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: ({ queryKey }) => {
          const args = z
            .object({ scope: z.enum(["public", "mine"]), site: z.string().nullable().optional() })
            .parse(queryKey[2]);
          switch (queryKey[1]) {
            case "scout/sites:count":
              return remote.count(args.scope);
            case "scout/sites:list":
              return {
                page: remote.sites.filter(
                  (site) =>
                    !args.site ||
                    site.hostname.includes(args.site) ||
                    site.profile?.name.toLowerCase().includes(args.site),
                ),
                isDone: false,
                continueCursor: "sites-next",
              };
            case "scout/activity:list":
              return {
                page: remote.tasks.get(args.site ?? "")?.results ?? [],
                isDone: true,
                continueCursor: "",
              };
            default:
              throw new Error("Unexpected TanStack query");
          }
        },
      },
    },
  });
  queryClients.push(queryClient);
  return queryClient;
}

async function openFeed(
  path = "/",
  dehydrated?: DehydratedState,
  queryClient = createQueryClient(),
  waitForResults = true,
) {
  if (dehydrated) hydrate(queryClient, dehydrated);
  const root = createRootRoute({ staticData: { access: "access_public" }, component: Outlet });
  const home = createRoute({
    path: "/",
    getParentRoute: () => root,
    staticData: { access: "access_public" },
    validateSearch: reviewFeedSearch,
    component: () => (
      <Suspense fallback={<SiteSearchLoading />}>
        <ActivityFeed search={home.useSearch()} />
      </Suspense>
    ),
  });
  const detail = createRoute({
    path: "/sites/$site",
    getParentRoute: () => root,
    staticData: { access: "access_public" },
    validateSearch: reviewFeedSearch,
    component: () => (
      <>
        <h1>{detail.useParams().site}</h1>
        <SiteTaskList site={detail.useParams().site} search={detail.useSearch()} />
      </>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      home,
      detail,
      createRoute({
        getParentRoute: () => root,
        path: "/scouts/$slug",
        staticData: { access: "access_public" },
        component: () => <h1>Scout profile</h1>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  if (waitForResults) await screen.findByRole("article", { name: "chessmerge.com" });
  return { router, queryClient };
}

test("a direct filtered visit shows a spinner in the results until the first query completes", async () => {
  const queryClient = createQueryClient();
  const pending = createControlledPromise<FunctionReturnType<typeof api.scout.sites.list>>();
  queryClient.setQueryDefaults(
    convexQuery(api.scout.sites.list, {
      site: "chess",
      scope: "public",
      paginationOpts: { numItems: 6, cursor: null },
    }).queryKey,
    { queryFn: () => pending },
  );
  await openFeed("/?scope=public&site=chess", undefined, queryClient, false);
  const reviews = await screen.findByRole("region", { name: "Reviews" });
  expect(within(reviews).getByRole("status", { name: "Searching sites" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Filter by site" })).toHaveProperty("value", "chess");
  expect(screen.queryByText("No sites match your search.")).toBeNull();
  await act(async () => pending.resolve({ page: remote.sites, isDone: true, continueCursor: "" }));
  await screen.findByRole("article", { name: "chessmerge.com" });
  expect(screen.queryByRole("status", { name: "Searching sites" })).toBeNull();
});

test("searching shows a list spinner from typing until delayed results arrive", async () => {
  const { queryClient, router } = await openFeed();
  const pending = createControlledPromise<FunctionReturnType<typeof api.scout.sites.list>>();
  queryClient.setQueryDefaults(
    convexQuery(api.scout.sites.list, {
      site: "paper",
      scope: "public",
      paginationOpts: { numItems: 6, cursor: null },
    }).queryKey,
    { queryFn: () => pending },
  );
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "Filter by site" });
  await user.type(input, "paper");
  const spinner = screen.getByRole("status", { name: "Searching sites" });
  expect(input.parentElement?.contains(spinner)).toBe(false);
  await waitFor(() => expect(router.state.location.search.site).toBe("paper"));
  expect(screen.getByRole("status", { name: "Searching sites" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Filter by site" })).toBe(input);
  await act(async () => pending.resolve({ page: remote.sites, isDone: true, continueCursor: "" }));
  await waitFor(() => expect(screen.queryByRole("status", { name: "Searching sites" })).toBeNull());
  expect(screen.getByRole("article", { name: "papergames.io" })).toBeTruthy();
  expect(screen.queryByRole("article", { name: "chessmerge.com" })).toBeNull();
});

test.each(["matches", "nothing found"])(
  "keeps spinning across empty search pages until the response is %s",
  async (outcome) => {
    remote.sitePages.set("paper", {
      results: [],
      status: "CanLoadMore",
      isLoading: false,
      loadMore: remote.loadSites,
    });
    const { queryClient, router } = await openFeed();
    const pending = createControlledPromise<FunctionReturnType<typeof api.scout.sites.list>>();
    queryClient.setQueryDefaults(
      convexQuery(api.scout.sites.list, {
        site: "paper",
        scope: "public",
        paginationOpts: { numItems: 6, cursor: null },
      }).queryKey,
      { queryFn: () => pending },
    );
    await userEvent.setup().type(screen.getByRole("textbox", { name: "Filter by site" }), "paper");
    await waitFor(() => expect(router.state.location.search.site).toBe("paper"));
    await act(async () =>
      pending.resolve({ page: [], isDone: false, continueCursor: "next-sites" }),
    );
    expect(screen.getByRole("status", { name: "Searching sites" })).toBeTruthy();
    expect(screen.queryByText("No sites match your search.")).toBeNull();

    remote.loadSites.mockImplementationOnce(() => {
      remote.sitePages.set("paper", {
        results: [],
        status: "LoadingMore",
        isLoading: true,
        loadMore: remote.loadSites,
      });
      remote.revision++;
      for (const listener of remote.listeners) listener();
    });
    const sentinel = observers.find((observer) => observer.targets.size > 0);
    if (!sentinel) throw new Error("Missing search pagination sentinel");
    await act(async () => sentinel.intersect(true));
    expect(remote.loadSites).toHaveBeenCalledWith(6);
    vi.useFakeTimers();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.getByRole("status", { name: "Searching sites" })).toBeTruthy();
    expect(screen.queryByText("No sites match your search.")).toBeNull();
    vi.useRealTimers();

    await act(async () => {
      remote.sitePages.set("paper", {
        results: outcome === "matches" ? remote.sites.slice(1) : [],
        status: "Exhausted",
        isLoading: false,
        loadMore: remote.loadSites,
      });
      remote.revision++;
      for (const listener of remote.listeners) listener();
    });
    expect(screen.queryByRole("status", { name: "Searching sites" })).toBeNull();
    if (outcome === "matches")
      expect(screen.getByRole("article", { name: "papergames.io" })).toBeTruthy();
    else expect(screen.getByText("No sites match your search.")).toBeTruthy();
  },
);

test("keeps server-rendered cards and reviews visible until live subscriptions arrive", async () => {
  const serverCache = createQueryClient();
  serverCache.setQueryData(convexQuery(api.scout.sites.count, { scope: "public" }).queryKey, {
    count: 2,
    hasMore: false,
  });
  serverCache.setQueryData(
    convexQuery(api.scout.sites.list, {
      site: null,
      scope: "public",
      paginationOpts: { numItems: 6, cursor: null },
    }).queryKey,
    { page: remote.sites, isDone: true, continueCursor: "" },
  );
  for (const site of remote.sites) {
    serverCache.setQueryData(
      convexQuery(api.scout.activity.list, {
        site: site.hostname,
        scope: "public",
        paginationOpts: { numItems: 2, cursor: null },
      }).queryKey,
      { page: [task(site.hostname, 1)], isDone: true, continueCursor: "" },
    );
  }
  remote.loadingSites = true;
  remote.count.mockReturnValue(undefined);
  for (const site of remote.sites)
    remote.tasks.set(site.hostname, {
      results: [],
      status: "LoadingFirstPage",
      isLoading: true,
      loadMore: remote.loadChessTasks,
    });
  const { queryClient } = await openFeed("/", dehydrate(serverCache));
  const originalCard = screen.getByRole("article", { name: "chessmerge.com" });
  expect(screen.getByText("2 reviewed sites")).toBeTruthy();
  expect(within(originalCard).getByRole("heading", { name: "chessmerge.com task 1" })).toBeTruthy();
  expect(screen.queryByText("No public tasks yet.")).toBeNull();
  remote.loadingSites = false;
  queryClient.setQueryData(convexQuery(api.scout.sites.count, { scope: "public" }).queryKey, {
    count: 3,
    hasMore: false,
  });
  remote.tasks.set("chessmerge.com", {
    results: [{ ...task("chessmerge.com", 1), title: "Live updated review" }],
    status: "Exhausted",
    isLoading: false,
    loadMore: remote.loadChessTasks,
  });
  act(() => {
    remote.revision++;
    for (const listener of remote.listeners) listener();
  });
  expect(await screen.findByRole("heading", { name: "Live updated review" })).toBeTruthy();
  expect(screen.getByRole("article", { name: "chessmerge.com" })).toBe(originalCard);
  expect(screen.getByText("3 reviewed sites")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "chessmerge.com task 1" })).toBeNull();
});

test.each(["/?scope=mine", "/?site=chess"])(
  "keeps cached first pages isolated by scope and filter: %s",
  async (path) => {
    const serverCache = createQueryClient();
    serverCache.setQueryData(
      convexQuery(api.scout.sites.list, {
        site: null,
        scope: "public",
        paginationOpts: { numItems: 6, cursor: null },
      }).queryKey,
      {
        page: [{ ...remote.sites[0], hostname: "stale.example" }],
        isDone: true,
        continueCursor: "",
      },
    );
    remote.loadingSites = true;
    await openFeed(path, dehydrate(serverCache));
    expect(screen.queryByRole("article", { name: "stale.example" })).toBeNull();
  },
);

test.each(["homepage", "site"])(
  "%s scout pills navigate independently from task rows",
  async (surface) => {
    const { router } = await openFeed();
    const user = userEvent.setup();
    if (surface === "site")
      await user.click(screen.getByRole("link", { name: "View all 7 tasks" }));
    const pill = (await screen.findAllByRole("link", { name: "Scout: Scout" }))[0];
    if (!pill) throw new Error("Expected a scout link");
    expect(pill.getAttribute("href")).toBe("/scouts/scout");
    expect(pill.parentElement?.closest("a")).toBeNull();
    expect(
      screen.getByRole("link", { name: "chessmerge.com task 1" }).getAttribute("href"),
    ).toContain("/tasks/chessmerge.com-1");
    pill.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Scout profile" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/scouts/scout");
  },
);

test("requests six sites initially and two tasks for each site", async () => {
  await openFeed();

  expect(screen.getByText("1,000+ reviewed sites")).toBeTruthy();
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

test.each(["public", "mine"])(
  "View all tasks opens the site's task page and preserves the %s scope",
  async (scope) => {
    const { router } = await openFeed(`/?scope=${scope}`);
    expect(
      screen.getByText(scope === "public" ? "1,000+ reviewed sites" : "1 reviewed site"),
    ).toBeTruthy();
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

test("keeps the feed and new card shells visible while next-page task previews load", async () => {
  const { queryClient } = await openFeed();
  const feed = screen.getByRole("region", { name: "Reviews" });
  const originalCards = screen.getAllByRole("article");
  const nextSites = Array.from({ length: 6 }, (_, index) => ({
    ...remote.sites[1],
    hostname: `next-${index}.example`,
  }));
  const pendingSite = nextSites[0].hostname;
  let resolvePending: (page: FunctionReturnType<typeof api.scout.activity.list>) => void;
  const pending = new Promise<FunctionReturnType<typeof api.scout.activity.list>>((resolve) => {
    resolvePending = resolve;
  });
  const { queryKey } = convexQuery(api.scout.activity.list, {
    site: pendingSite,
    scope: "public",
    paginationOpts: { numItems: 2, cursor: null },
  });
  queryClient.setQueryDefaults(queryKey, { queryFn: () => pending });
  for (const site of nextSites) {
    remote.tasks.set(site.hostname, {
      results: [],
      status: "LoadingFirstPage",
      isLoading: true,
      loadMore: vi.fn(),
    });
  }
  remote.loadSites.mockImplementationOnce(() => {
    remote.sites.push(...nextSites);
    remote.revision++;
    for (const listener of remote.listeners) listener();
  });
  const sentinel = observers.find((observer) => observer.targets.size > 0);
  if (!sentinel) throw new Error("Missing site pagination sentinel");

  await act(async () => sentinel.intersect(true));
  expect(remote.loadSites).toHaveBeenCalledExactlyOnceWith(6);
  expect(queryClient.isFetching({ queryKey })).toBe(1);
  expect(screen.getByRole("region", { name: "Reviews" })).toBe(feed);
  originalCards.forEach((card, index) => expect(screen.getAllByRole("article")[index]).toBe(card));
  expect(screen.getAllByRole("article")).toHaveLength(8);
  const pendingCard = screen.getByRole("article", { name: pendingSite });
  expect(within(pendingCard).getByRole("heading", { name: pendingSite })).toBeTruthy();
  expect(within(pendingCard).getByTestId("site-preview")).toBeTruthy();
  expect(pendingCard.querySelector('[aria-busy="true"]')).toBeTruthy();
  expect(within(pendingCard).queryByText("No public tasks yet.")).toBeNull();
  expect(within(pendingCard).queryByRole("heading", { level: 3 })).toBeNull();

  await act(async () => {
    resolvePending({ page: [task(pendingSite, 1)], isDone: true, continueCursor: "" });
  });
  expect(
    await within(pendingCard).findByRole("heading", { name: `${pendingSite} task 1` }),
  ).toBeTruthy();
  expect(screen.getByRole("region", { name: "Reviews" })).toBe(feed);
  originalCards.forEach((card, index) => expect(screen.getAllByRole("article")[index]).toBe(card));
  expect(screen.getByRole("article", { name: pendingSite })).toBe(pendingCard);
});

test.each(["public", "mine"])("site heading links preserve the %s scope", async (scope) => {
  const { router } = await openFeed(`/?scope=${scope}`);
  const user = userEvent.setup();

  for (const site of ["chessmerge.com", "papergames.io"]) {
    const card = within(screen.getByRole("article", { name: site }));
    const link = card.getByRole("link", {
      name: `View tasks for ${site === "chessmerge.com" ? "Chess Merge" : site}`,
    });
    expect(link.getAttribute("href")).toBe(`/sites/${site}?scope=${scope}`);
    const previewLink = card.getByRole("link", {
      name: `View ${site === "chessmerge.com" ? "Chess Merge" : site} details`,
    });
    expect(previewLink.getAttribute("href")).toBe(link.getAttribute("href"));
    expect(within(previewLink).getByTestId("site-preview")).toBeTruthy();
    const website = card.getByRole("link", { name: site });
    expect(website.getAttribute("href")).toBe(`https://${site}`);
    expect(website.getAttribute("target")).toBe("_blank");
    expect(website.closest("a a")).toBeNull();
    expect(
      card.getByRole("heading", {
        name: site === "chessmerge.com" ? "Chess Merge" : site,
        level: 2,
      }),
    ).toBeTruthy();
  }
  await user.click(screen.getByRole("link", { name: "View tasks for papergames.io" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/sites/papergames.io"));
  expect(router.state.location.search).toEqual({ scope });
  expect(await screen.findByRole("region", { name: "Tasks for papergames.io" })).toBeTruthy();
  expect(screen.queryByTestId("site-preview")).toBeNull();
  expect(screen.queryByRole("button", { name: "Show more tasks" })).toBeNull();
  expect(screen.getByRole("link", { name: /papergames.io task 1/ }).getAttribute("href")).toContain(
    "/tasks/",
  );
});

test("the site filter is bookmarked, restored by history, and carried through every card link", async () => {
  const { router } = await openFeed("/?scope=mine");
  const user = userEvent.setup();
  const filter = screen.getByRole("textbox", { name: "Filter by site" });
  await user.type(filter, "Chess");
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ scope: "mine", site: "chess" }),
  );
  await waitFor(() => expect(filter).toHaveProperty("value", "chess"));
  await waitFor(() => expect(screen.queryByRole("article", { name: "papergames.io" })).toBeNull());
  const card = within(screen.getByRole("article", { name: "chessmerge.com" }));
  for (const name of [
    "View Chess Merge details",
    "View tasks for Chess Merge",
    "View all 7 tasks",
  ]) {
    const href = card.getByRole("link", { name }).getAttribute("href");
    expect(href).toBeTruthy();
    const url = new URL(href ?? "", "http://localhost");
    expect(url.pathname).toBe("/sites/chessmerge.com");
    expect(url.searchParams.get("site")).toBe("chess");
    expect(url.searchParams.get("scope")).toBe("mine");
  }
  const taskUrl = new URL(
    card.getByRole("link", { name: /chessmerge.com task 1/ }).getAttribute("href") ?? "",
    "http://localhost",
  );
  expect(taskUrl.searchParams.get("site")).toBe("chess");
  expect(taskUrl.searchParams.get("scope")).toBe("mine");
  expect(router.history.length).toBe(1);
  await user.click(screen.getByRole("link", { name: "View all 7 tasks" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/sites/chessmerge.com"));
  expect(router.state.location.search).toEqual({ scope: "mine", site: "chess" });
  const detailTask = await screen.findByRole("link", { name: /chessmerge.com task 1/ });
  expect(detailTask.getAttribute("href")).toContain("scope=mine");
  expect(detailTask.getAttribute("href")).toContain("site=chess");
  act(() => router.history.back());
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Filter by site" })).toHaveProperty(
      "value",
      "chess",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Clear site filter" }));
  await waitFor(() => expect(router.state.location.search).toEqual({ scope: "mine" }));
  expect(screen.getByRole("textbox", { name: "Filter by site" })).toHaveProperty("value", "");
});
