// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
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
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { omitNullish } from "../../shared/omitNullish";
import { Route as SiteRoute } from "../routes/sites.$site";
import { reviewFeedSearch } from "../lib/reviewFeedSearch";

type Site = NonNullable<FunctionReturnType<typeof api.scout.sites.get>>;

const remote = vi.hoisted(() => ({
  read: vi.fn(),
  execute: vi.fn(),
  manual: vi.fn(),
  query: vi.fn(),
  paginated: vi.fn(),
  refresh: vi.fn(),
  sites: new Map<string, Site>(),
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
vi.mock("./activity-feed", () => ({
  SiteTaskList: ({ site }: { site: string }) => <p>Tasks for {site}</p>,
}));
vi.mock("convex/react", () => ({
  usePaginatedQuery: (
    _ref: FunctionReference<"query">,
    args: Omit<FunctionArgs<typeof api.scout.sites.list>, "paginationOpts">,
  ) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    remote.paginated(args);
    return {
      results: [...remote.sites.values()].filter(
        (site) =>
          !args.site ||
          site.hostname.includes(args.site) ||
          site.profile?.name.toLowerCase().includes(args.site),
      ),
      status: "Exhausted",
    };
  },
  useQuery: (
    _ref: FunctionReference<"query">,
    args:
      | FunctionArgs<typeof api.scout.workspaces.list>
      | FunctionArgs<typeof api.scout.sites.get>
      | "skip",
  ) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    if (args === "skip") return undefined;
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
      case "agentsApi/siteResearch:refresh":
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
  remote.admin = true;
  remote.signedIn = true;
  remote.revision = 0;
  remote.sites.clear();
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
        validateSearch: reviewFeedSearch,
        staticData: { access: "access_public" },
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

test("opens a site, previews and downloads files, and runs commands without a chat", async () => {
  const router = await openPage("/sites/chessmerge.com");
  const user = userEvent.setup();
  expect(await screen.findByText("Tasks for chessmerge.com")).toBeTruthy();
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
  await user.click(screen.getByRole("link", { name: "View tasks for Papergames" }));
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
  await user.click(screen.getByRole("link", { name: "View tasks for Papergames" }));
  await screen.findByRole("heading", { name: "Papergames" });
  expect(await screen.findByRole("button", { name: "Show sites" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show sites" }));
  await user.click(screen.getByRole("button", { name: "Back to site" }));
  expect(await screen.findByRole("button", { name: "Show sites" })).toBeTruthy();
});

test("members see tasks and cannot mount the workspace from its URL", async () => {
  remote.admin = false;
  await openPage("/sites/chessmerge.com?view=workspace");
  expect(await screen.findByText("Tasks for chessmerge.com")).toBeTruthy();
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

test("shows the product name above the hostname in the heading and sidebar, and visits the researched homepage", async () => {
  await openPage("/sites/chessmerge.com");
  const heading = await screen.findByRole("heading", { name: "Chess Merge", level: 1 });
  expect(heading.nextElementSibling?.textContent).toBe("chessmerge.com");
  const link = screen.getByRole("link", { name: "View tasks for Chess Merge" });
  const card = link.closest("li");
  if (!card) throw new Error("Missing site card");
  const name = within(card).getByText("Chess Merge");
  expect(name.nextElementSibling?.textContent).toBe("chessmerge.com");
  expect(
    screen
      .getAllByRole("link", { name: "chessmerge.com" })
      .map((link) => link.getAttribute("href")),
  ).toEqual(["https://www.chessmerge.com/play", "https://www.chessmerge.com/play"]);
  expect(screen.queryByRole("link", { name: "Visit website" })).toBeNull();
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

test.each([
  { admin: true, signedIn: true },
  { admin: false, signedIn: true },
  { admin: false, signedIn: false },
])(
  "shows the site description below its identity and above tasks, admin=$admin, signedIn=$signedIn",
  async ({ admin, signedIn }) => {
    remote.admin = admin;
    remote.signedIn = signedIn;
    await openPage("/sites/chessmerge.com");
    const heading = await screen.findByRole("heading", { name: "Chess Merge", level: 1 });
    const description = screen.getByText("Play chess variants with friends in your browser.");
    const tasks = screen.getByText("Tasks for chessmerge.com");
    const hostname = heading.nextElementSibling;
    if (!hostname) throw new Error("Missing site hostname");
    expect(description.tagName).toBe("P");
    expect(
      hostname.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(screen.getByRole("navigation", { name: "Sites" })).queryByText(
        "Play chess variants with friends in your browser.",
      ),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: /overview|description/i })).toBeNull();
    expect(remote.refresh).not.toHaveBeenCalled();
  },
);

test("shows an existing profile without an overview without adding description copy", async () => {
  await openPage("/sites/papergames.io");
  const heading = await screen.findByRole("heading", { name: "Papergames", level: 1 });
  const tasks = screen.getByText("Tasks for papergames.io");
  expect(heading.nextElementSibling?.textContent).toBe("papergames.io");
  expect(tasks.parentElement?.querySelectorAll(":scope > p")).toHaveLength(1);
  expect(remote.refresh).not.toHaveBeenCalled();
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
  expect(
    within(screen.getByRole("navigation", { name: "Sites" })).getAllByRole("link", {
      name: /^View tasks for/,
    }),
  ).toHaveLength(2);
  expect(router.state.location.search.view).toBe("workspace");
  await user.click(visibility);
  await user.click(screen.getByRole("option", { name: "Public reviews" }));
  await waitFor(() => expect(router.state.location.search.scope).toBe("public"));
  await user.type(filter, "not-a-site");
  await waitFor(() => expect(router.state.location.search.site).toBe("not-a-site"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("No sites match these filters.")).toBeTruthy();
  await user.clear(filter);
  await user.type(filter, "Paper");
  await waitFor(() => expect(router.state.location.search.site).toBe("paper"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(remote.paginated).toHaveBeenLastCalledWith({ scope: "public", site: "paper" });
  act(() => router.history.back());
  await waitFor(() => expect(filter).toHaveProperty("value", ""));
  act(() => router.history.forward());
  await waitFor(() => expect(filter).toHaveProperty("value", "paper"));
  await user.click(screen.getByRole("link", { name: "All sites" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(router.state.location.search).toEqual({ site: "paper", scope: "public" });
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
  fireEvent.keyDown(resize, { key: "ArrowRight", shiftKey: true });
  fireEvent.keyDown(resize, { key: "ArrowRight", shiftKey: true });
  expect(resize.getAttribute("aria-valuenow")).toBe("368");
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  expect(resize.getAttribute("aria-valuenow")).toBe("368");
  fireEvent.keyDown(resize, { key: "ArrowLeft" });
  const width = resize.getAttribute("aria-valuenow");
  expect(Number(width)).toBeGreaterThan(240);
  const scroller = navigation.closest<HTMLElement>("[data-sidebar-layout-part='pane-scrollport']");
  if (!scroller) throw new Error("Missing sidebar scroller");
  scroller.scrollTop = 120;
  remote.loadingSites.add("papergames.io");
  await userEvent
    .setup()
    .click(within(navigation).getByRole("link", { name: "View tasks for Papergames" }));
  expect(await screen.findByText("Loading site…")).toBeTruthy();
  expect(router.state.location.pathname).toBe("/sites/papergames.io");
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
