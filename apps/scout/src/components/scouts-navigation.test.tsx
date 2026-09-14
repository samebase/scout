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
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { omitNullish } from "../../shared/omitNullish";
import { Route as ScoutsRoute } from "../routes/scouts.index";
import { Route as ScoutRoute } from "../routes/scouts.$slug";
import { ScoutSidebarProvider } from "../sidebars/ScoutSidebarProvider";
import { readAccessKeysForRole } from "../../shared/accessModel";

const remote = vi.hoisted(() => ({
  admin: true,
  action: vi.fn(),
  mutation: vi.fn(),
  scout: {
    _id: "scout-1",
    slug: "conrad",
    websiteIdentity: { firstName: "Conrad", lastName: "Scout" },
    displayName: "Conrad Scout",
    status: "active",
    agentMail: { inboxId: "inbox-1", address: "conrad@example.test" },
    firecrawl: { profileName: "conrad" },
  },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useAction: () => remote.action,
  useMutation: () => remote.mutation,
  useQuery: (reference: FunctionReference<"query">, args?: unknown) => {
    if (args === "skip") return undefined;
    switch (getFunctionName(reference)) {
      case "accounts:currentViewerAccess":
        return {
          kind: "account",
          accessKeys: readAccessKeysForRole(remote.admin ? "role_staff" : "role_member"),
        };
      case "scout/scouts:list":
        return [remote.scout];
      case "scout/scouts:get":
        return remote.scout;
      case "scout/serviceAccounts:list":
        if (!remote.admin) throw new Error("Member queried private accounts");
        return [];
      case "scout/scouts:resources":
        if (!remote.admin) throw new Error("Member queried private resources");
        return { agentMail: remote.scout.agentMail, firecrawl: remote.scout.firecrawl };
      default:
        throw new Error("Unexpected query: " + getFunctionName(reference));
    }
  },
}));

afterEach(() => {
  remote.admin = true;
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

async function openPage(path: string) {
  const root = createRootRoute({
    staticData: { access: "access_public" },
    component: () => (
      <ScoutSidebarProvider>
        <Outlet />
      </ScoutSidebarProvider>
    ),
  });
  const scouts = createRoute({
    path: "/scouts",
    getParentRoute: () => root,
    component: Outlet,
    staticData: { access: "access_scout_view" },
  });
  const index = createRoute({
    path: "/",
    staticData: { access: "access_scout_view" },
    getParentRoute: () => scouts,
    ...omitNullish({
      component: ScoutsRoute.options.component,
      validateSearch: ScoutsRoute.options.validateSearch,
    }),
  });
  const detail = createRoute({
    path: "$slug",
    staticData: { access: "access_scout_view" },
    getParentRoute: () => scouts,
    ...omitNullish({
      component: ScoutRoute.options.component,
      validateSearch: ScoutRoute.options.validateSearch,
    }),
  });
  const router = createRouter({
    routeTree: root.addChildren([scouts.addChildren([index, detail])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

test("members can browse Scout profiles without loading management panels or private queries", async () => {
  remote.admin = false;
  const router = await openPage("/scouts?view=register");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: /Conrad Scout/ }));
  expect(await screen.findByRole("heading", { name: "Conrad Scout" })).toBeTruthy();
  expect(screen.getByText("conrad@example.test")).toBeTruthy();
  await act(() =>
    router.navigate({
      to: "/scouts/$slug",
      params: { slug: "conrad" },
      search: { view: "add-account" },
    }),
  );
  expect(screen.queryByRole("button", { name: "Register scout" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add account" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Runtime resources" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(remote.action).not.toHaveBeenCalled();
  expect(remote.mutation).not.toHaveBeenCalled();
});

test.each([
  { path: "/scouts", button: "Register scout", field: "First name", view: "register" },
  { path: "/scouts/conrad", button: "Add account", field: "Service name", view: "add-account" },
])(
  "restores the $button panel through Back, Forward, and reload",
  async ({ path, button, field, view }) => {
    const router = await openPage(path);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: button }));
    expect(router.state.location.search).toEqual({ view });
    await user.type(screen.getByRole("textbox", { name: field }), "Private form value");
    const bookmark = router.state.location.href;
    expect(bookmark).not.toContain("Private");
    act(() => router.history.back());
    await waitFor(() => expect(screen.queryByRole("textbox", { name: field })).toBeNull());
    act(() => router.history.forward());
    expect(await screen.findByRole("textbox", { name: field })).toBeTruthy();
    cleanup();
    await openPage(bookmark);
    expect(await screen.findByRole("textbox", { name: field })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: field })).toBeNull());
    expect(remote.action).not.toHaveBeenCalled();
    expect(remote.mutation).not.toHaveBeenCalled();
  },
);

test.each(["successful", "failed"])(
  "ignores a %s account save after Back opens a new draft",
  async (outcome) => {
    let completeSave: () => void = () => {
      throw new Error("No account save is pending");
    };
    remote.action.mockImplementationOnce(
      () =>
        new Promise<null>((resolve, reject) => {
          completeSave = () => {
            if (outcome === "successful") resolve(null);
            else reject(new Error("First save failed"));
          };
        }),
    );
    const router = await openPage("/scouts/conrad");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add account" }));
    fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "First" } });
    fireEvent.change(screen.getByLabelText("Service domain"), {
      target: { value: "first.test" },
    });
    fireEvent.change(screen.getByLabelText("Password", { selector: 'input[type="password"]' }), {
      target: { value: "first password" },
    });
    await user.click(screen.getByRole("button", { name: "Save account" }));
    expect(remote.action).toHaveBeenCalledTimes(1);

    act(() => router.history.back());
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Add account" }));
    await user.type(screen.getByLabelText("Service name"), "Second unsaved account");
    const draft = screen.getByRole("form", { name: "Add account" });
    await act(async () => completeSave());

    expect(screen.getByRole("form", { name: "Add account" })).toBe(draft);
    expect(screen.getByLabelText<HTMLInputElement>("Service name").value).toBe(
      "Second unsaved account",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Save account" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(router.state.location.search).toEqual({ view: "add-account" });
  },
);
