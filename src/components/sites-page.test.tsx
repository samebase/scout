// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { Route as SitesRoute } from "../routes/sites.index";
import { Route as SiteRoute } from "../routes/sites.$site";

const remote = vi.hoisted(() => ({
  read: vi.fn(),
  execute: vi.fn(),
  manual: vi.fn(),
  query: vi.fn(),
}));
vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({ results: ["chessmerge.com", "papergames.io"], status: "Exhausted" }),
  useQuery: (
    _ref: FunctionReference<"query">,
    args: FunctionArgs<typeof api.scout.workspaces.list>,
  ) => {
    remote.query(args);
    return {
      exists: "site" in args.target && args.target.site !== "missing.example",
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
  const sites = createRoute({
    path: "/sites",
    getParentRoute: () => root,
    staticData: { access: "access_lab" },
    component: Outlet,
  });
  const index = createRoute({
    path: "/",
    getParentRoute: () => sites,
    staticData: { access: "access_lab" },
    ...omitNullish({ component: SitesRoute.options.component }),
  });
  const detail = createRoute({
    path: "$site",
    getParentRoute: () => sites,
    staticData: { access: "access_lab" },
    ...omitNullish({
      component: SiteRoute.options.component,
      validateSearch: SiteRoute.options.validateSearch,
    }),
  });
  const router = createRouter({
    routeTree: root.addChildren([sites.addChildren([index, detail])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

test("opens a site, previews and downloads files, and runs commands without a chat", async () => {
  const router = await openPage("/sites");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "chessmerge.com" }));
  await user.click(await screen.findByRole("button", { name: "guide.md" }));
  expect((await screen.findByLabelText("File contents")).textContent).toBe("Site guide");
  expect(remote.read).toHaveBeenCalledWith({
    target: { site: "chessmerge.com" },
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
    expect(await screen.findByText("Site workspace not found.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Bash command" })).toBeNull();
    expect(remote.execute).not.toHaveBeenCalled();
    expect(remote.manual).not.toHaveBeenCalled();
  },
);
