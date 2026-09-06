// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useSyncExternalStore, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { accountPermissions } from "../../shared/accessModel";
import { RouteAccessOutlet } from "./route-access";
import { AppNavigation } from "./app-navigation";
import { Route as SettingsRoute } from "../routes/settings";
import { omitNullish } from "../../shared/omitNullish";
import { ReviewLanding } from "../products/review/landing";

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
  useQuery: () => {
    useSyncExternalStore(subscribe, () => remote.revision);
    return remote.values.get("viewer");
  },
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

function setViewer(
  role: "role_admin" | "role_member",
  status: "active" | "suspended" = "active",
  isApproved = true,
) {
  act(() => {
    remote.values.set("viewer", {
      kind: "account",
      userId: "account",
      role,
      status,
      isApproved,
      accessKeys: accountPermissions(role, status, isApproved),
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
    path: "/chats",
    staticData: { access: "access_lab" },
    component: () => {
      remote.lab();
      return <h1>Lab contents</h1>;
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
    path: "/review",
    staticData: { access: "access_public" },
    component: ReviewLanding,
  });
  const router = createRouter({
    routeTree: root.addChildren([lab, settings, review]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
}

test("protected children wait for access and unmount on revocation", async () => {
  await open("/chats");
  expect((await screen.findByRole("status")).textContent).toContain("Loading account");
  expect(remote.lab).not.toHaveBeenCalled();
  setViewer("role_admin");
  expect(await screen.findByRole("heading", { name: "Lab contents" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
  setViewer("role_member");
  expect(await screen.findByRole("heading", { name: "Access unavailable" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Lab contents" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Chats" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Scouts" })).toBeNull();
  expect(screen.getByRole("link", { name: "Play" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Review" })).toBeTruthy();
});

test("a direct Lab link never mounts restricted content for a member", async () => {
  setViewer("role_member");
  await open("/chats");
  expect(await screen.findByRole("heading", { name: "Access unavailable" })).toBeTruthy();
  expect(remote.lab).not.toHaveBeenCalled();
});

test("suspended accounts retain account controls", async () => {
  setViewer("role_admin", "suspended");
  await open("/settings");
  expect(await screen.findByRole("heading", { name: "Your session" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
});

test("Review is a public preview and only permitted accounts see its Lab link", async () => {
  remote.authenticated = false;
  await open("/review");
  expect(await screen.findByText("Scout Review is in preview.")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Open the Lab" })).toBeNull();
  remote.authenticated = true;
  setViewer("role_member");
  expect(screen.queryByRole("link", { name: "Open the Lab" })).toBeNull();
  setViewer("role_admin");
  expect(await screen.findByRole("link", { name: "Open the Lab" })).toBeTruthy();
});

test("pending members keep account controls and receive approval without signing in again", async () => {
  setViewer("role_member", "active", false);
  await open("/settings");
  expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Your session" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
  setViewer("role_member", "active", true);
  expect(await screen.findByRole("heading", { name: "Account approved" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Play" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  setViewer("role_member", "active", false);
  expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
});

test("pending admins cannot mount Lab content until approved and unmount when approval is revoked", async () => {
  setViewer("role_admin", "active", false);
  await open("/chats");
  expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
  expect(remote.lab).not.toHaveBeenCalled();
  setViewer("role_admin", "active", true);
  expect(await screen.findByRole("heading", { name: "Lab contents" })).toBeTruthy();
  setViewer("role_admin", "active", false);
  expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Lab contents" })).toBeNull();
});
