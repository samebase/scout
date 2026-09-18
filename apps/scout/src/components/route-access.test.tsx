// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { readAccessKeysForRole, type ViewerRole } from "../../shared/accessModel";
import { RouteAccessOutlet } from "./route-access";
import { AppNavigation } from "./app-navigation";
import { Route as SettingsRoute } from "../routes/settings";
import { Route as ScoutsRoute } from "../routes/scouts";
import { omitNullish } from "../../shared/omitNullish";

const remote = vi.hoisted(() => ({
  authenticated: true,
  revision: 0,
  values: new Map<string, unknown>(),
  subscribers: new Set<() => void>(),
  lab: vi.fn(),
}));
function subscribe(listener: () => void) {
  remote.subscribers.add(listener);
  return () => remote.subscribers.delete(listener);
}
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: remote.authenticated, isLoading: false }),
  AuthLoading: () => null,
  Authenticated: ({ children }: { children: ReactNode }) =>
    remote.authenticated ? children : null,
  Unauthenticated: ({ children }: { children: ReactNode }) =>
    remote.authenticated ? null : children,
  useQuery: (reference: FunctionReference<"query">) => {
    useSyncExternalStore(subscribe, () => remote.revision);
    if (getFunctionName(reference) === "credits:balance") return null;
    if (getFunctionName(reference) === "credits:offer") return undefined;
    return remote.values.get("viewer");
  },
  useMutation: () => async () => {},
  useAction: () => async () => {},
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: () => {} }),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: async () => {}, signIn: async () => ({ signingIn: true }) }),
}));
beforeEach(() => {
  remote.authenticated = true;
  remote.values.clear();
  remote.lab.mockClear();
  remote.revision = 0;
});
afterEach(cleanup);

function setViewer(role: ViewerRole, isApproved = role !== "role_pending_access") {
  act(() => {
    remote.values.set("viewer", {
      kind: "account",
      userId: "account",
      role,
      isApproved,
      accessKeys: readAccessKeysForRole(role),
    });
    remote.revision += 1;
    for (const listener of remote.subscribers) listener();
  });
}

async function open(path: string) {
  const root = createRootRoute({
    staticData: { access: "access_public" },
    component: () => (
      <>
        <AppNavigation />
        <RouteAccessOutlet />
      </>
    ),
  });
  const lab = createRoute({
    getParentRoute: () => root,
    path: "/agents",
    staticData: { access: "access_lab" },
    component: () => {
      remote.lab();
      return <h1>Agents contents</h1>;
    },
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    staticData: { access: "access_account" },
    ...omitNullish({ component: SettingsRoute.options.component }),
  });
  const review = createRoute({
    getParentRoute: () => root,
    path: "/tasks/$thread",
    staticData: { access: "access_public" },
    component: () => <h1>Review contents</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      lab,
      settings,
      review,
      createRoute({
        getParentRoute: () => root,
        path: "/scouts",
        staticData: ScoutsRoute.options.staticData,
        component: () => <h1>Scouts directory</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/",
        staticData: { access: "access_public" },
        component: () => <h1>Activity contents</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/play",
        staticData: { access: "access_public" },
        component: () => <h1>Play contents</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/account-deletion",
        staticData: { access: "access_public" },
        component: () => <h1>Account deletion</h1>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
}

test("protected children wait for access and unmount on revocation", async () => {
  await open("/agents");
  expect((await screen.findByRole("status")).textContent).toContain("Loading account");
  expect(remote.lab).not.toHaveBeenCalled();
  setViewer("role_staff");
  expect(await screen.findByRole("heading", { name: "Agents contents" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
  setViewer("role_member");
  expect(await screen.findByRole("heading", { name: "Access unavailable" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Agents contents" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Agents" })).toBeNull();
  expect(screen.getByRole("link", { name: "Scouts" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Reviews" })).toBeTruthy();
});

test("a direct Agents link never mounts restricted content for a member", async () => {
  setViewer("role_member");
  await open("/agents");
  expect(await screen.findByRole("heading", { name: "Access unavailable" })).toBeTruthy();
  expect(remote.lab).not.toHaveBeenCalled();
});

test("members can navigate to Scouts and lose access when approval is revoked", async () => {
  setViewer("role_member");
  await open("/");
  const user = userEvent.setup();
  await user.click(screen.getByRole("link", { name: "Scouts" }));
  expect(await screen.findByRole("heading", { name: "Scouts directory" })).toBeTruthy();
  setViewer("role_pending_access");
  expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Scouts directory" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Scouts" })).toBeNull();
});

test("pending accounts retain account controls", async () => {
  setViewer("role_pending_access");
  await open("/settings");
  expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Your session" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  expect(screen.getByRole("link", { name: "Reviews" })).toBeTruthy();
});

test("staff keep Agents and settings admin access without approval", async () => {
  setViewer("role_staff", false);
  await open("/settings");
  expect(await screen.findByRole("heading", { name: "Admin access" })).toBeTruthy();
  expect(screen.getByText("You have admin access.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
});

test("pending members keep account controls and receive approval without signing in again", async () => {
  setViewer("role_pending_access");
  await open("/settings");
  expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Your session" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Reviews" })).toBeTruthy();
  setViewer("role_member");
  expect(await screen.findByRole("heading", { name: "Account approved" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Reviews" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  setViewer("role_pending_access");
  expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Reviews" })).toBeTruthy();
});

test("guests can navigate public pages and sign in without seeing admin links", async () => {
  remote.authenticated = false;
  await open("/");
  const user = userEvent.setup();
  expect(screen.getByRole("link", { name: "Reviews" }).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  for (const name of ["Agents", "Scouts", "Sites", "Members"]) {
    expect(screen.queryByRole("link", { name })).toBeNull();
  }

  expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
  await user.click(screen.getByRole("link", { name: "Sign in" }));
  expect(await screen.findByRole("heading", { name: "Sign in to Scout" })).toBeTruthy();
  expect(screen.getByLabelText("Email")).toBeTruthy();
  expect(remote.lab).not.toHaveBeenCalled();
});

test("staff can mount Agents content before member approval", async () => {
  setViewer("role_staff", false);
  await open("/agents");
  expect(await screen.findByRole("heading", { name: "Agents contents" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
});

test.each(["deleting", "deleted"])(
  "%s accounts leave protected content for the deletion page",
  async (kind) => {
    setViewer("role_staff");
    await open("/agents");
    expect(await screen.findByRole("heading", { name: "Agents contents" })).toBeTruthy();
    act(() => {
      remote.values.set("viewer", { kind });
      remote.revision += 1;
      for (const listener of remote.subscribers) listener();
    });
    expect(await screen.findByRole("heading", { name: "Account deletion" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Agents contents" })).toBeNull();
  },
);
