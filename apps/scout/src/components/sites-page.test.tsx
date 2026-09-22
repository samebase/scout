// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { useSyncExternalStore } from "react";
import type { UsePaginatedQueryReturnType } from "convex/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { omitNullish } from "../../shared/omitNullish";
import { Route as SiteRoute } from "../routes/sites.$site";
import { homeSearch } from "../lib/homeSearch";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import { z } from "zod";

let queryClient: QueryClient;

type Site = NonNullable<FunctionReturnType<typeof api.scout.sites.get>>;
type Activity = FunctionReturnType<typeof api.scout.activity.list>["page"][number];
type Sites = UsePaginatedQueryReturnType<typeof api.scout.sites.list>;

const remote = vi.hoisted(() => ({
  read: vi.fn(),
  execute: vi.fn(),
  manual: vi.fn(),
  query: vi.fn(),
  paginated: vi.fn(),
  activityQueries: vi.fn(),
  tasks: new Map<string, Activity[]>(),
  refresh: vi.fn(),
  sites: new Map<string, Site>(),
  sitePages: new Map<string, Sites>(),
  loadingSites: new Set<string>(),
  subscribers: new Set<() => void>(),
  revision: 0,
  admin: true,
  signedIn: true,
}));
function subscribe(listener: () => void) {
  remote.subscribers.add(listener);
  return () => remote.subscribers.delete(listener);
}

function updateSite(site: Site) {
  act(() => {
    remote.sites.set(site.hostname, site);
    queryClient.setQueryData(
      convexQuery(api.scout.sites.get, { site: site.hostname }).queryKey,
      site,
    );
    remote.revision += 1;
    for (const listener of remote.subscribers) listener();
  });
}

vi.mock("../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/access")>()),
  useViewerAccess: () =>
    remote.signedIn
      ? { kind: "account", accessKeys: remote.admin ? ["access_lab"] : [] }
      : { kind: "anonymous" },
}));
vi.mock("./site-preview", () => ({ SitePreview: () => <div />, SitePreviewCapture: () => null }));
vi.mock("convex-helpers/react", async () => ({
  usePaginatedQuery: (await import("convex/react")).usePaginatedQuery,
}));
vi.mock("convex/react", () => ({
  usePaginatedQuery: (
    ref: FunctionReference<"query">,
    args: Omit<FunctionArgs<typeof api.scout.sites.list>, "paginationOpts">,
    options: { initialNumItems: number },
  ) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    if (getFunctionName(ref) === "scout/activity:list") {
      remote.activityQueries(args, options);
      return { results: remote.tasks.get(args.site ?? "") ?? [], status: "Exhausted" };
    }
    remote.paginated(args);
    const page = remote.sitePages.get(args.site ?? "");
    if (page) return page;
    return {
      results: [...remote.sites.values()]
        .filter(
          (site) =>
            !args.site ||
            site.hostname.includes(args.site) ||
            site.profile?.name.toLowerCase().includes(args.site),
        )
        .map((site) => ({ ...site, taskCount: remote.tasks.get(site.hostname)?.length ?? 0 })),
      status: "Exhausted",
    };
  },
  useQuery: (
    ref: FunctionReference<"query">,
    args:
      | FunctionArgs<typeof api.scout.workspaces.list>
      | FunctionArgs<typeof api.scout.sites.get>
      | FunctionArgs<typeof api.scout.sites.count>
      | "skip",
  ) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    if (getFunctionName(ref) === "credits:balance") return null;
    if (getFunctionName(ref) === "credits:offer") return undefined;
    if (args === "skip") return undefined;
    if ("scope" in args) return { count: 9, hasMore: false };
    if ("site" in args)
      return remote.loadingSites.has(args.site) ? undefined : (remote.sites.get(args.site) ?? null);
    remote.query(args);
    return {
      exists: args.target.kind === "site" && args.target.site !== "missing.example",
      configured: true,
      cwd: "/workspace",
      revision: 1,
      entries: [
        {
          kind: "file",
          path: "/workspace/guide.md",
          key: "guide",
          size: 5,
          sha256: "hash",
          mode: 420,
          mtime: 0,
        },
      ],
    };
  },
  useAction: (ref: FunctionReference<"action">) => {
    switch (getFunctionName(ref)) {
      case "tasks/siteResearch:refresh":
        return remote.refresh;
      case "scout/workspaceTools:readFile":
        return remote.read;
      case "scout/workspaceTools:executeSiteCommand":
        return remote.execute;
      case "scout/manual:executeTool":
        return remote.manual;
      default:
        throw new Error("Unexpected action");
    }
  },
}));

beforeEach(() => {
  notifyManager.setScheduler((callback) => callback());
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: ({ queryKey }) => {
          const args = z.object({ site: z.string().nullable().optional() }).parse(queryKey[2]);
          switch (queryKey[1]) {
            case "scout/sites:count":
              return { count: 9, hasMore: false };
            case "scout/sites:list":
              return { page: [...remote.sites.values()], isDone: true, continueCursor: "" };
            case "scout/activity:list":
              return {
                page: remote.tasks.get(args.site ?? "") ?? [],
                isDone: true,
                continueCursor: "",
              };
            case "scout/sites:get": {
              const site = args.site ?? "";
              if (!remote.loadingSites.has(site)) return remote.sites.get(site) ?? null;
              return new Promise<Site | null>((resolve) => {
                const unsubscribe = subscribe(() => {
                  if (!remote.loadingSites.has(site)) {
                    unsubscribe();
                    resolve(remote.sites.get(site) ?? null);
                  }
                });
              });
            }
            default:
              throw new Error("Unexpected TanStack query");
          }
        },
      },
    },
  });
  window.localStorage.clear();
  remote.admin = true;
  remote.signedIn = true;
  remote.revision = 0;
  remote.sites.clear();
  remote.sitePages.clear();
  remote.tasks.clear();
  remote.loadingSites.clear();
  remote.sites.set("papergames.io", {
    hostname: "papergames.io",
    preview: null,
    profile: { name: "Papergames", homepageUrl: "https://papergames.io/en", researchedAt: 1000 },
    research: { status: "completed", error: null },
  });
  remote.sites.set("chessmerge.com", {
    hostname: "chessmerge.com",
    preview: null,
    profile: {
      name: "Chess Merge",
      homepageUrl: "https://www.chessmerge.com/play",
      overview: "Play chess variants with friends in your browser.",
      researchedAt: 1000,
    },
    research: { status: "completed", error: null },
  });
  remote.refresh.mockReset().mockResolvedValue("research-1");
  remote.read.mockResolvedValue({
    path: "/workspace/guide.md",
    text: "Site guide",
    bytes: new TextEncoder().encode("Site guide").buffer,
  });
  remote.execute.mockResolvedValue({
    stdout: "Site guide",
    stderr: "",
    exitCode: 0,
    cwd: "/workspace",
    workspace: "chessmerge.com",
    revision: 1,
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:site-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function openPage(path: string) {
  const root = createRootRoute({ staticData: { access: "access_public" }, component: Outlet });
  const detail = createRoute({
    path: "/sites/$site",
    getParentRoute: () => root,
    staticData: { access: "access_public" },
    ...omitNullish({
      component: SiteRoute.options.component,
      validateSearch: SiteRoute.options.validateSearch,
    }),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      detail,
      createRoute({
        getParentRoute: () => root,
        path: "/",
        validateSearch: homeSearch,
        staticData: { access: "access_public" },
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
  return router;
}

test.each([true, false])(
  "opens a new task for the current site, signed in: %s",
  async (signedIn) => {
    remote.signedIn = signedIn;
    const router = await openPage("/sites/chessmerge.com?site=chess&scope=mine");
    const link = await screen.findByRole("link", { name: "New task" });
    expect(
      new URL(link.getAttribute("href") ?? "", "https://scout.test").searchParams.get("taskSite"),
    ).toBe("chessmerge.com");
    await userEvent.setup().click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.location.search).toEqual({
      taskSite: "chessmerge.com",
      site: "chess",
      scope: signedIn ? "mine" : "public",
    });
  },
);

test("opens a site, previews and downloads files, and runs commands without a chat", async () => {
  const router = await openPage("/sites/chessmerge.com");
  const user = userEvent.setup();
  expect(await screen.findByRole("region", { name: "Tasks for chessmerge.com" })).toBeTruthy();
  await user.click(await screen.findByRole("link", { name: "Workspace" }));
  await user.click(await screen.findByRole("button", { name: "guide.md" }));
  expect((await screen.findByLabelText("File contents")).textContent).toBe("Site guide");
  expect(remote.read).toHaveBeenCalledWith({
    target: { kind: "site", site: "chessmerge.com" },
    path: "/workspace/guide.md",
  });
  const download = screen.getByRole("link", { name: "Download" });
  expect(download.getAttribute("download")).toBe("guide.md");
  expect(download.getAttribute("href")).toBe("blob:site-preview");
  const bookmark = router.state.location.href;
  fireEvent.change(screen.getByRole("textbox", { name: "Bash command" }), {
    target: { value: "cat guide.md" },
  });
  await user.click(screen.getByRole("button", { name: "Run command" }));
  await waitFor(() =>
    expect(remote.execute).toHaveBeenCalledExactlyOnceWith({
      site: "chessmerge.com",
      command: "cat guide.md",
    }),
  );
  expect(remote.manual).not.toHaveBeenCalled();
  act(() => router.history.back());
  await waitFor(() => expect(screen.queryByLabelText("File contents")).toBeNull());
  act(() => router.history.forward());
  expect(await screen.findByLabelText("File contents")).toBeTruthy();
  cleanup();
  await openPage(bookmark);
  expect((await screen.findByLabelText("File contents")).textContent).toBe("Site guide");
});

test.each(["missing.example", "invalid-host"])(
  "shows a missing site without a terminal: %s",
  async (site) => {
    await openPage(`/sites/${site}`);
    expect(await screen.findByText("Site not found.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Bash command" })).toBeNull();
    expect(remote.execute).not.toHaveBeenCalled();
    expect(remote.manual).not.toHaveBeenCalled();
  },
);

test("switches sites from the sidebar and clears the previous file and terminal draft", async () => {
  const router = await openPage(
    "/sites/chessmerge.com?view=workspace&file=%2Fworkspace%2Fguide.md",
  );
  const user = userEvent.setup();
  await screen.findByLabelText("File contents");
  expect(
    screen.getByRole("link", { name: "View tasks for Chess Merge" }).getAttribute("aria-current"),
  ).toBe("page");
  fireEvent.change(screen.getByRole("textbox", { name: "Bash command" }), {
    target: { value: "old draft" },
  });
  await user.click(await screen.findByRole("link", { name: "View tasks for Papergames" }));
  await screen.findByRole("heading", { name: "Papergames" });
  expect(router.state.location.search.file).toBeUndefined();
  expect(screen.queryByLabelText("File contents")).toBeNull();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Bash command" }).value).toBe("");
  expect(remote.query).toHaveBeenCalledWith({ target: { kind: "site", site: "papergames.io" } });
  expect(
    screen.getByRole("link", { name: "View tasks for Papergames" }).getAttribute("aria-current"),
  ).toBe("page");
  act(() => router.history.back());
  expect(await screen.findByLabelText("File contents")).toBeTruthy();
});

test("opens the mobile site list and returns to the workspace after selecting a site", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
  await openPage("/sites/chessmerge.com");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Show sites" }));
  expect(await screen.findByRole("button", { name: "Back to site" })).toBeTruthy();
  await user.click(await screen.findByRole("link", { name: "View tasks for Papergames" }));
  await screen.findByRole("heading", { name: "Papergames" });
  expect(await screen.findByRole("button", { name: "Show sites" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show sites" }));
  await user.click(screen.getByRole("button", { name: "Back to site" }));
  expect(await screen.findByRole("button", { name: "Show sites" })).toBeTruthy();
});

test("members see tasks and cannot mount the workspace from its URL", async () => {
  remote.admin = false;
  await openPage("/sites/chessmerge.com?view=workspace");
  expect(await screen.findByRole("region", { name: "Tasks for chessmerge.com" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Workspace" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Bash command" })).toBeNull();
  expect(remote.query).not.toHaveBeenCalled();
});

test.each([
  { admin: true, scope: "public" },
  { admin: true, scope: "mine" },
  { admin: false, scope: "public" },
  { admin: false, scope: "mine" },
])(
  "site navigation keeps directory scope and order: $scope, admin=$admin",
  async ({ admin, scope }) => {
    remote.admin = admin;
    await openPage(`/sites/chessmerge.com?scope=${scope}`);
    const navigation = await screen.findByRole("navigation", { name: "Sites" });
    expect(remote.paginated).toHaveBeenLastCalledWith({ scope, site: null });
    expect(
      within(navigation)
        .getAllByRole("link", { name: /^View tasks for/ })
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual(["View tasks for Papergames", "View tasks for Chess Merge"]);
  },
);

test("keeps the researched homepage usable while a refresh is running or fails", async () => {
  await openPage("/sites/chessmerge.com");
  expect(
    screen
      .getAllByRole("link", { name: "chessmerge.com" })
      .map((link) => link.getAttribute("href")),
  ).toEqual(["https://www.chessmerge.com/play", "https://www.chessmerge.com/play"]);
  expect(document.querySelector("a a")).toBeNull();
  for (const website of screen.getAllByRole("link", { name: "chessmerge.com" })) {
    expect(website.getAttribute("target")).toBe("_blank");
    expect(website.getAttribute("rel")).toBe("noreferrer");
  }
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh research" }));
  expect(remote.refresh).toHaveBeenCalledExactlyOnceWith({ site: "chessmerge.com" });
  const site = remote.sites.get("chessmerge.com");
  if (!site) throw new Error("Missing site fixture");
  updateSite({ ...site, research: { status: "running", error: null } });
  expect(screen.getByRole("button", { name: "Researching…" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("heading", { name: "Chess Merge", level: 1 })).toBeTruthy();
  updateSite({ ...site, research: { status: "failed", error: "Refresh failed" } });
  expect(screen.getByRole("button", { name: "Retry research" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("heading", { name: "Chess Merge", level: 1 })).toBeTruthy();
  expect(
    screen
      .getAllByRole("link", { name: "chessmerge.com" })
      .map((link) => link.getAttribute("href")),
  ).toEqual(["https://www.chessmerge.com/play", "https://www.chessmerge.com/play"]);
});

test("researches a pending site and updates its name, address, and description when the profile arrives", async () => {
  const site: Site = { hostname: "chessmerge.com", preview: null, profile: null, research: null };
  remote.sites.set(site.hostname, site);
  await openPage("/sites/chessmerge.com");
  const heading = await screen.findByRole("heading", { name: "chessmerge.com", level: 1 });
  expect(heading.nextElementSibling).toBeNull();
  expect(
    screen
      .getAllByRole("link", { name: "chessmerge.com" })
      .map((link) => link.getAttribute("href")),
  ).toEqual(["https://chessmerge.com", "https://chessmerge.com"]);
  let completeRefresh: () => void = () => {
    throw new Error("No research request is pending");
  };
  remote.refresh.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        completeRefresh = () => resolve("research-1");
      }),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Research site" }));
  expect(screen.getByRole("button", { name: "Researching…" })).toHaveProperty("disabled", true);
  await user.click(screen.getByRole("button", { name: "Researching…" }));
  expect(remote.refresh).toHaveBeenCalledExactlyOnceWith({ site: site.hostname });
  updateSite({ ...site, research: { status: "running", error: null } });
  await act(async () => completeRefresh());
  expect(screen.getByRole("button", { name: "Researching…" })).toHaveProperty("disabled", true);
  updateSite({
    ...site,
    profile: {
      name: "Chess Merge",
      homepageUrl: "https://www.chessmerge.com/play",
      overview: "Play chess variants with friends in your browser.",
      researchedAt: 2000,
    },
    research: { status: "completed", error: null },
  });
  expect(screen.getByRole("heading", { name: "Chess Merge", level: 1 })).toBeTruthy();
  expect(screen.getByText("Play chess variants with friends in your browser.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "View tasks for Chess Merge" })).toBeTruthy();
  expect(
    screen
      .getAllByRole("link", { name: "chessmerge.com" })
      .map((link) => link.getAttribute("href")),
  ).toEqual(["https://www.chessmerge.com/play", "https://www.chessmerge.com/play"]);
  expect(screen.getByRole("button", { name: "Refresh research" })).toHaveProperty(
    "disabled",
    false,
  );
});

test.each(["running", "waiting"] satisfies NonNullable<Site["research"]>["status"][])(
  "disables research for an existing %s record",
  async (status) => {
    remote.sites.set("chessmerge.com", {
      hostname: "chessmerge.com",
      preview: null,
      profile: null,
      research: { status, error: null },
    });
    await openPage("/sites/chessmerge.com");
    const button = await screen.findByRole("button", { name: "Researching…" });
    expect(button).toHaveProperty("disabled", true);
    await userEvent.setup().click(button);
    expect(remote.refresh).not.toHaveBeenCalled();
  },
);

test("shows research failures and permits an explicit retry after an action failure", async () => {
  remote.sites.set("chessmerge.com", {
    hostname: "chessmerge.com",
    preview: null,
    profile: null,
    research: { status: "failed", error: "Research provider unavailable" },
  });
  remote.refresh.mockRejectedValueOnce(new Error("Could not start research"));
  await openPage("/sites/chessmerge.com");
  expect((await screen.findByRole("alert")).textContent).toBe("Research provider unavailable");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Retry research" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not start research");
  expect(screen.getByRole("button", { name: "Retry research" })).toHaveProperty("disabled", false);
  await user.click(screen.getByRole("button", { name: "Retry research" }));
  expect(remote.refresh).toHaveBeenCalledTimes(2);
  updateSite({
    hostname: "chessmerge.com",
    preview: null,
    profile: null,
    research: { status: "running", error: null },
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

test.each([
  { signedIn: true, ready: true },
  { signedIn: true, ready: false },
  { signedIn: false, ready: true },
  { signedIn: false, ready: false },
])(
  "hides research controls from non-admin viewers, signedIn=$signedIn, ready=$ready",
  async ({ signedIn, ready }) => {
    remote.admin = false;
    remote.signedIn = signedIn;
    remote.sites.set("chessmerge.com", {
      hostname: "chessmerge.com",
      preview: null,
      profile: ready
        ? {
            name: "Chess Merge",
            homepageUrl: "https://www.chessmerge.com/play",
            researchedAt: 1000,
          }
        : null,
      research: null,
    });
    await openPage("/sites/chessmerge.com");
    await screen.findByRole("heading", { name: ready ? "Chess Merge" : "chessmerge.com" });
    expect(screen.queryByRole("button", { name: /research/i })).toBeNull();
    expect(
      screen
        .getAllByRole("link", { name: "chessmerge.com" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(Array(2).fill(ready ? "https://www.chessmerge.com/play" : "https://chessmerge.com"));
    expect(remote.refresh).not.toHaveBeenCalled();
  },
);

test("a direct site visit shows a spinner inside the sidebar while its first results load", async () => {
  remote.signedIn = false;
  const pending = createControlledPromise<FunctionReturnType<typeof api.scout.sites.list>>();
  queryClient.setQueryDefaults(
    convexQuery(api.scout.sites.list, {
      site: "paper",
      scope: "public",
      paginationOpts: { numItems: 20, cursor: null },
    }).queryKey,
    { queryFn: () => pending },
  );
  await openPage("/sites/chessmerge.com?scope=public&site=paper");
  const navigation = await screen.findByRole("navigation", { name: "Sites" });
  expect(within(navigation).getByRole("status", { name: "Searching sites" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Filter by site" })).toHaveProperty("value", "paper");
  expect(screen.queryByText("No sites match these filters.")).toBeNull();
  await act(async () => pending.resolve({ page: [], isDone: true, continueCursor: "" }));
  await waitFor(() => expect(within(navigation).queryByRole("status")).toBeNull());
  expect(within(navigation).getByRole("article", { name: "papergames.io" })).toBeTruthy();
});

test("sidebar search keeps its filter and navigation mounted while the list spinner waits for results", async () => {
  const router = await openPage("/sites/chessmerge.com?scope=public");
  const navigation = await screen.findByRole("navigation", { name: "Sites" });
  const input = screen.getByRole("textbox", { name: "Filter by site" });
  const pending = createControlledPromise<FunctionReturnType<typeof api.scout.sites.list>>();
  queryClient.setQueryDefaults(
    convexQuery(api.scout.sites.list, {
      site: "paper",
      scope: "public",
      paginationOpts: { numItems: 20, cursor: null },
    }).queryKey,
    { queryFn: () => pending },
  );
  await userEvent.setup().type(input, "paper");
  expect(within(navigation).getByRole("status", { name: "Searching sites" })).toBeTruthy();
  expect(within(input.parentElement ?? input).queryByRole("status")).toBeNull();
  await waitFor(() => expect(router.state.location.search.site).toBe("paper"));
  expect(within(navigation).getByRole("status", { name: "Searching sites" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Sites" })).toBe(navigation);
  expect(screen.getByRole("textbox", { name: "Filter by site" })).toBe(input);
  expect(screen.queryByText("No sites match these filters.")).toBeNull();
  await act(async () => pending.resolve({ page: [], isDone: true, continueCursor: "" }));
  await waitFor(() => expect(within(navigation).queryByRole("status")).toBeNull());
  expect(within(navigation).getByRole("article", { name: "papergames.io" })).toBeTruthy();
});

test("the sidebar keeps spinning through empty pages until no matches is confirmed", async () => {
  remote.sitePages.set("missing", {
    results: [],
    status: "CanLoadMore",
    isLoading: false,
    loadMore: vi.fn(),
  });
  await openPage("/sites/chessmerge.com?scope=public&site=missing");
  const navigation = await screen.findByRole("navigation", { name: "Sites" });
  expect(within(navigation).getByRole("status", { name: "Searching sites" })).toBeTruthy();
  expect(screen.queryByText("No sites match these filters.")).toBeNull();
  await act(async () => {
    remote.sitePages.set("missing", {
      results: [],
      status: "LoadingMore",
      isLoading: true,
      loadMore: vi.fn(),
    });
    remote.revision++;
    for (const listener of remote.subscribers) listener();
  });
  expect(within(navigation).getByRole("status", { name: "Searching sites" })).toBeTruthy();
  await act(async () => {
    remote.sitePages.set("missing", {
      results: [],
      status: "Exhausted",
      isLoading: false,
      loadMore: vi.fn(),
    });
    remote.revision++;
    for (const listener of remote.subscribers) listener();
  });
  expect(within(navigation).queryByRole("status")).toBeNull();
  expect(within(navigation).getByText("No sites match these filters.")).toBeTruthy();
});

test("site sidebar filters stay editable across views and browser history", async () => {
  const router = await openPage("/sites/chessmerge.com?scope=mine&site=chessmerge.com");
  const user = userEvent.setup();
  const filter = await screen.findByRole("textbox", { name: "Filter by site" });
  const visibility = screen.getByRole("combobox", { name: "Review visibility" });
  expect(filter).toHaveProperty("value", "chessmerge.com");
  expect(visibility.textContent).toBe("My reviews");
  expect(remote.paginated).toHaveBeenLastCalledWith({ scope: "mine", site: "chessmerge.com" });
  expect(
    within(screen.getByRole("navigation", { name: "Sites" })).getAllByRole("link", {
      name: /^View tasks for/,
    }),
  ).toHaveLength(1);
  await user.click(screen.getByRole("link", { name: "Workspace" }));
  await screen.findByRole("textbox", { name: "Bash command" });
  expect(router.state.location.search).toEqual({
    scope: "mine",
    site: "chessmerge.com",
    view: "workspace",
  });
  expect(screen.getByRole("textbox", { name: "Filter by site" })).toBe(filter);
  await user.click(screen.getByRole("button", { name: "Clear site filter" }));
  await waitFor(() => expect(router.state.location.search.site).toBeUndefined());
  await waitFor(() =>
    expect(
      within(screen.getByRole("navigation", { name: "Sites" })).getAllByRole("link", {
        name: /^View tasks for/,
      }),
    ).toHaveLength(2),
  );
  expect(router.state.location.search.view).toBe("workspace");
  await user.click(visibility);
  await user.click(screen.getByRole("option", { name: "Public reviews" }));
  await waitFor(() => expect(router.state.location.search.scope).toBe("public"));
  await user.type(filter, "not-a-site");
  await waitFor(() => expect(router.state.location.search.site).toBe("not-a-site"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(await screen.findByText("No sites match these filters.")).toBeTruthy();
  await user.clear(filter);
  await user.type(filter, "Paper");
  await waitFor(() => expect(router.state.location.search.site).toBe("paper"));
  expect(screen.queryByRole("alert")).toBeNull();
  await waitFor(() =>
    expect(remote.paginated).toHaveBeenLastCalledWith({ scope: "public", site: "paper" }),
  );
  act(() => router.history.back());
  await waitFor(() => expect(filter).toHaveProperty("value", ""));
  act(() => router.history.forward());
  await waitFor(() => expect(filter).toHaveProperty("value", "paper"));
  await user.click(screen.getByRole("link", { name: "All sites" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(router.state.location.search).toEqual({ site: "paper", scope: "public" });
});

test("changing task visibility keeps the site heading and views visible while tasks load", async () => {
  const router = await openPage("/sites/chessmerge.com?scope=public");
  const heading = await screen.findByRole("heading", { name: "Chess Merge" });
  const views = screen.getByRole("navigation", { name: "Site views" });
  const tasks = await screen.findByRole("region", { name: "Tasks for chessmerge.com" });
  let resolvePending: (page: FunctionReturnType<typeof api.scout.activity.list>) => void;
  const pending = new Promise<FunctionReturnType<typeof api.scout.activity.list>>((resolve) => {
    resolvePending = resolve;
  });
  const load = vi.fn(() => pending);
  queryClient.setQueryDefaults(
    convexQuery(api.scout.activity.list, {
      site: "chessmerge.com",
      scope: "mine",
      paginationOpts: { numItems: 10, cursor: null },
    }).queryKey,
    { queryFn: load },
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Review visibility" }));
  await user.click(screen.getByRole("option", { name: "My reviews" }));
  await waitFor(() => expect(router.state.location.search.scope).toBe("mine"));
  await waitFor(() => expect(load).toHaveBeenCalled());
  expect(screen.getByRole("heading", { name: "Chess Merge" })).toBe(heading);
  expect(screen.getByRole("navigation", { name: "Site views" })).toBe(views);
  await act(async () => resolvePending({ page: [], isDone: true, continueCursor: "" }));
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Tasks for chessmerge.com" })).not.toBe(tasks),
  );
  expect(screen.getByRole("heading", { name: "Chess Merge" })).toBe(heading);
  expect(screen.getByRole("navigation", { name: "Site views" })).toBe(views);
});

test("the filtered site sidebar retains its DOM, width, and scroll while another site loads", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1280, 720),
  );
  // The current site can remain open while the user filters the sidebar to another site.
  const router = await openPage("/sites/chessmerge.com?scope=mine&site=papergames.io");
  const navigation = await screen.findByRole("navigation", { name: "Sites" });
  const filter = screen.getByRole("textbox", { name: "Filter by site" });
  const resize = screen.getByRole("separator", { name: "Resize sites navigation" });
  for (let step = 0; step < 6; step += 1) {
    fireEvent.keyDown(resize, { key: "ArrowRight", shiftKey: true });
  }
  const width = resize.getAttribute("aria-valuenow");
  expect(Number(width)).toBeGreaterThan(640);
  const scroller = navigation.closest<HTMLElement>("[data-sidebar-layout-part='pane-scrollport']");
  if (!scroller) throw new Error("Missing sidebar scroller");
  scroller.scrollTop = 120;
  remote.loadingSites.add("papergames.io");
  await userEvent
    .setup()
    .click(within(navigation).getByRole("link", { name: "View tasks for Papergames" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/sites/papergames.io"));
  expect(screen.queryByRole("heading", { name: "Papergames" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Chessmerge" })).toBeNull();
  expect(screen.queryByText(/Loading/)).toBeNull();
  expect(router.state.location.search).toEqual({
    site: "papergames.io",
    scope: "mine",
    view: "tasks",
  });
  expect(screen.getByRole("navigation", { name: "Sites" })).toBe(navigation);
  expect(screen.getByRole("textbox", { name: "Filter by site" })).toBe(filter);
  expect(filter).toHaveProperty("value", "papergames.io");
  expect(scroller.scrollTop).toBe(120);
  expect(resize.getAttribute("aria-valuenow")).toBe(width);
  const site = remote.sites.get("papergames.io");
  if (!site) throw new Error("Missing site fixture");
  remote.loadingSites.delete(site.hostname);
  updateSite(site);
  expect(await screen.findByRole("heading", { name: "Papergames" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Sites" })).toBe(navigation);
  expect(scroller.scrollTop).toBe(120);
  expect(resize.getAttribute("aria-valuenow")).toBe(width);
});

test("new task previews keep the site sidebar visible with its width and scroll intact", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1280, 720),
  );
  await openPage("/sites/chessmerge.com");
  const navigation = await screen.findByRole("navigation", { name: "Sites" });
  const filter = screen.getByRole("textbox", { name: "Filter by site" });
  const resize = screen.getByRole("separator", { name: "Resize sites navigation" });
  fireEvent.keyDown(resize, { key: "ArrowRight", shiftKey: true });
  const width = resize.getAttribute("aria-valuenow");
  const scroller = navigation.closest<HTMLElement>("[data-sidebar-layout-part='pane-scrollport']");
  if (!scroller) throw new Error("Missing sidebar scroller");
  scroller.scrollTop = 120;
  let resolvePending: (page: FunctionReturnType<typeof api.scout.activity.list>) => void;
  const pending = new Promise<FunctionReturnType<typeof api.scout.activity.list>>((resolve) => {
    resolvePending = resolve;
  });
  const { queryKey } = convexQuery(api.scout.activity.list, {
    site: "next.example",
    scope: "public",
    paginationOpts: { numItems: 2, cursor: null },
  });
  queryClient.setQueryDefaults(queryKey, { queryFn: () => pending });

  updateSite({ hostname: "next.example", preview: null, profile: null, research: null });
  const card = await within(navigation).findByRole("article", { name: "next.example" });
  expect(queryClient.isFetching({ queryKey })).toBe(1);
  expect(screen.getByRole("navigation", { name: "Sites" })).toBe(navigation);
  expect(screen.getByRole("textbox", { name: "Filter by site" })).toBe(filter);
  expect(resize.getAttribute("aria-valuenow")).toBe(width);
  expect(scroller.scrollTop).toBe(120);
  expect(within(card).getByRole("link", { name: "View tasks for next.example" })).toBeTruthy();
  expect(within(card).queryByText("No public tasks yet.")).toBeNull();

  await act(async () => resolvePending({ page: [], isDone: true, continueCursor: "" }));
  expect(await within(card).findByText("No public tasks yet.")).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Sites" })).toBe(navigation);
  expect(scroller.scrollTop).toBe(120);
  expect(resize.getAttribute("aria-valuenow")).toBe(width);
});

test("restores the site sidebar width after reopening a different site", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1280, 720),
  );
  await openPage("/sites/chessmerge.com");
  const resize = await screen.findByRole("separator", { name: "Resize sites navigation" });
  fireEvent.keyDown(resize, { key: "ArrowRight", shiftKey: true });
  const width = resize.getAttribute("aria-valuenow");
  expect(Number(width)).toBeGreaterThan(240);

  cleanup();
  await openPage("/sites/papergames.io");
  const restored = await screen.findByRole("separator", { name: "Resize sites navigation" });
  expect(restored.getAttribute("aria-valuenow")).toBe(width);
});

test.each(["public", "mine"])(
  "sidebar previews link to the first two tasks and the full list with scope %s",
  async (scope) => {
    remote.tasks.set(
      "papergames.io",
      [1, 2, 3].map(
        (number): Activity => ({
          threadId: `paper-task-${number}`,
          title: `Paper task ${number}`,
          primarySite: "papergames.io",
          createdAt: number,
          purpose: { kind: "review" },
          visibility: scope === "mine" ? "private" : "public",
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
        }),
      ),
    );
    const router = await openPage(`/sites/chessmerge.com?scope=${scope}&site=paper&view=workspace`);
    const navigation = await screen.findByRole("navigation", { name: "Sites" });
    const card = within(navigation).getByRole("article", { name: "papergames.io" });
    expect(remote.activityQueries).toHaveBeenCalledWith(
      { site: "papergames.io", scope },
      { initialNumItems: 2 },
    );
    for (const number of [1, 2]) {
      const link = within(card).getByRole("link", { name: `Paper task ${number}` });
      const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
      expect(url.pathname).toBe(`/tasks/paper-task-${number}`);
      expect(Object.fromEntries(url.searchParams)).toEqual({ scope, site: "paper", view: "chat" });
    }
    expect(within(card).queryByRole("link", { name: "Paper task 3" })).toBeNull();
    const siteLink = within(card).getByRole("link", { name: "View tasks for Papergames" });
    expect(siteLink.getAttribute("href")).toContain("view=workspace");
    await userEvent.setup().click(within(card).getByRole("link", { name: "View all 3 tasks" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sites/papergames.io"));
    expect(router.state.location.search).toEqual({ scope, site: "paper", view: "tasks" });
    expect(screen.getByRole("navigation", { name: "Sites" })).toBe(navigation);
    expect(within(navigation).getByRole("article", { name: "papergames.io" })).toBe(card);
    expect(siteLink.getAttribute("aria-current")).toBe("page");
  },
);
