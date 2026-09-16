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
import { getFunctionName, type FunctionArgs, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { omitNullish } from "../../shared/omitNullish";
import { Route as SiteRoute } from "../routes/sites.$site";

const remote = vi.hoisted(() => ({
  read: vi.fn(),
  execute: vi.fn(),
  manual: vi.fn(),
  query: vi.fn(),
  paginated: vi.fn(),
  admin: true,
}));
vi.mock("../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/access")>()),
  useViewerAccess: () => ({ kind: "account", accessKeys: remote.admin ? ["access_lab"] : [] }),
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
    remote.paginated(args);
    return {
      results: [{ hostname: "papergames.io" }, { hostname: "chessmerge.com" }],
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
    if (args === "skip") return undefined;
    if ("site" in args) return args.site === "missing.example" ? null : { hostname: args.site };
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
    routeTree: root.addChildren([detail]),
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
  expect(screen.getByRole("link", { name: "chessmerge.com" }).getAttribute("aria-current")).toBe(
    "page",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Bash command" }), {
    target: { value: "old draft" },
  });
  await user.click(screen.getByRole("link", { name: "papergames.io" }));
  await screen.findByRole("heading", { name: "papergames.io" });
  expect(router.state.location.search.file).toBeUndefined();
  expect(screen.queryByLabelText("File contents")).toBeNull();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Bash command" }).value).toBe("");
  expect(remote.query).toHaveBeenCalledWith({ target: { kind: "site", site: "papergames.io" } });
  expect(screen.getByRole("link", { name: "papergames.io" }).getAttribute("aria-current")).toBe(
    "page",
  );
  act(() => router.history.back());
  expect(await screen.findByLabelText("File contents")).toBeTruthy();
});

test("opens the mobile site list and returns to the workspace after selecting a site", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
  await openPage("/sites/chessmerge.com");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Show sites" }));
  expect(await screen.findByRole("button", { name: "Back to site" })).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "papergames.io" }));
  await screen.findByRole("heading", { name: "papergames.io" });
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
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["papergames.io", "chessmerge.com"]);
  },
);
