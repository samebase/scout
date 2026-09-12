// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { Route as DeletionRoute } from "../routes/account-deletion";

const remote = vi.hoisted<{
  status: FunctionReturnType<typeof api.accountDeletion.status>;
  authenticated: boolean;
  request: Mock;
  retry: Mock;
  signOut: Mock;
  listeners: Set<() => void>;
}>(() => ({
  status: { kind: "ready" },
  authenticated: true,
  request: vi.fn(),
  retry: vi.fn(),
  signOut: vi.fn(),
  listeners: new Set(),
}));

function subscribe(listener: () => void) {
  remote.listeners.add(listener);
  return () => remote.listeners.delete(listener);
}
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: remote.authenticated, isLoading: false }),
  useQuery: () => useSyncExternalStore(subscribe, () => remote.status),
  useMutation: (reference: FunctionReference<"mutation">) => {
    switch (getFunctionName(reference)) {
      case "accountDeletion:request":
        return remote.request;
      case "accountDeletion:retry":
        return remote.retry;
      default:
        throw new Error("Unexpected mutation");
    }
  },
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: remote.signOut }) }));

beforeEach(() => {
  remote.status = { kind: "ready" };
  remote.authenticated = true;
  remote.request.mockReset().mockResolvedValue(null);
  remote.retry.mockReset().mockResolvedValue(null);
  remote.signOut.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

function setStatus(kind: typeof remote.status.kind) {
  act(() => {
    remote.status = { kind };
    for (const listener of remote.listeners) listener();
  });
}
async function open() {
  const component = DeletionRoute.options.component;
  if (!component) throw new Error("Missing deletion page");
  const root = createRootRoute({ staticData: { access: "access_public" } });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/account-deletion",
    staticData: { access: "access_public" },
    component,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/account-deletion"] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
}

test("retention is explicit and deletion requires the exact phrase", async () => {
  const user = userEvent.setup();
  await open();
  expect(
    await screen.findByText("Your chats, messages, attachments, and Scout history will stay."),
  ).toBeTruthy();
  const confirm = screen.getByRole("button", { name: "Delete account" });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  await user.type(screen.getByLabelText("Type delete my account to confirm"), "delete my account");
  await user.click(confirm);
  expect(remote.request).toHaveBeenCalledWith({ confirmation: "delete my account" });
  expect(remote.signOut).not.toHaveBeenCalled();
  setStatus("deleting");
  expect(await screen.findByText("Deleting your account…")).toBeTruthy();
  expect(remote.signOut).not.toHaveBeenCalled();
  setStatus("deleted");
  expect(await screen.findByRole("heading", { name: "Account deleted" })).toBeTruthy();
  await waitFor(() => expect(remote.signOut).toHaveBeenCalledOnce());
});

test("failed deletion offers retry without reporting success or signing out", async () => {
  remote.status = { kind: "failed" };
  const user = userEvent.setup();
  await open();
  await user.click(await screen.findByRole("button", { name: "Retry deletion" }));
  expect(remote.retry).toHaveBeenCalledWith({});
  expect(remote.request).not.toHaveBeenCalled();
  expect(remote.signOut).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Account deleted" })).toBeNull();
});
