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
import { Route as CreditHistoryRoute } from "../routes/credit-history";
import { Route as ScoutsRoute } from "../routes/scouts";
import { Route as PrivacyRoute } from "../routes/privacy";
import { Route as TermsRoute } from "../routes/terms";
import { Route as AboutRoute } from "../routes/about";
import { Route as HandoffRoute } from "../routes/handoff.$sessionId";
import { omitNullish } from "../../shared/omitNullish";
import { TERMS_ACCEPTANCE_LABEL } from "../../shared/terms";
import { ConvexError } from "convex/values";

const remote = vi.hoisted(() => ({
  authenticated: true,
  authLoading: false,
  revision: 0,
  values: new Map<string, unknown>(),
  subscribers: new Set<() => void>(),
  lab: vi.fn(),
  accept: vi.fn(),
}));
function subscribe(listener: () => void) {
  remote.subscribers.add(listener);
  return () => remote.subscribers.delete(listener);
}
vi.mock("convex/react", () => ({
  useConvexAuth: () => {
    useSyncExternalStore(subscribe, () => remote.revision);
    return { isAuthenticated: remote.authenticated, isLoading: remote.authLoading };
  },
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
  useMutation: (reference: FunctionReference<"mutation">) =>
    getFunctionName(reference) === "accounts:acceptTerms" ? remote.accept : async () => {},
  useAction: () => async () => {},
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: () => {} }),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: async () => {}, signIn: async () => ({ signingIn: true }) }),
}));
beforeEach(() => {
  remote.authenticated = true;
  remote.authLoading = false;
  remote.values.clear();
  remote.lab.mockClear();
  remote.accept.mockReset().mockResolvedValue(null);
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
    path: "/lab",
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
    path: "/tasks/$thread",
    staticData: { access: "access_public" },
    component: () => <h1>Review contents</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      lab,
      settings,
      createRoute({
        getParentRoute: () => root,
        path: "/credit-history",
        staticData: CreditHistoryRoute.options.staticData,
        ...omitNullish({ component: CreditHistoryRoute.options.component }),
      }),
      review,
      createRoute({
        getParentRoute: () => root,
        path: "/about",
        staticData: AboutRoute.options.staticData,
        ...omitNullish({ component: AboutRoute.options.component }),
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/sites/$site",
        staticData: { access: "access_public" },
        component: () => <h1>Site contents</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/handoff/$sessionId",
        staticData: HandoffRoute.options.staticData,
        component: () => <h1>Handoff browser</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/privacy",
        staticData: PrivacyRoute.options.staticData,
        ...omitNullish({ component: PrivacyRoute.options.component }),
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/terms",
        staticData: TermsRoute.options.staticData,
        ...omitNullish({ component: TermsRoute.options.component }),
      }),
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
  await act(async () => {
    render(<RouterProvider router={router} />);
    await router.load();
  });
}

test("protected children wait for access and unmount on revocation", async () => {
  await open("/lab");
  expect((await screen.findByRole("main", { busy: true })).textContent).toBe("");
  expect(remote.lab).not.toHaveBeenCalled();
  setViewer("role_staff");
  expect(await screen.findByRole("heading", { name: "Lab contents" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
  setViewer("role_member");
  expect(await screen.findByRole("heading", { name: "Access unavailable" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Lab contents" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Lab" })).toBeNull();
  expect(screen.getByRole("link", { name: "Scouts" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Reviews" })).toBeTruthy();
});

test.each(["anonymous", "loading", "terms_required", "deleted"])(
  "handoff opens for %s viewers without account or terms gating",
  async (state) => {
    if (state === "anonymous") remote.authenticated = false;
    else if (state !== "loading") remote.values.set("viewer", { kind: state });
    await open("/handoff/session");
    expect(await screen.findByRole("heading", { name: "Handoff browser" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Review our terms" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sign in to Scout" })).toBeNull();
  },
);

test("a direct Lab link never mounts restricted content for a member", async () => {
  setViewer("role_member");
  await open("/lab");
  expect(await screen.findByRole("heading", { name: "Access unavailable" })).toBeTruthy();
  expect(remote.lab).not.toHaveBeenCalled();
});

test("the public Scouts page stays accessible when membership is revoked", async () => {
  setViewer("role_member");
  await open("/");
  const user = userEvent.setup();
  await user.click(screen.getByRole("link", { name: "Scouts" }));
  expect(await screen.findByRole("heading", { name: "Scouts directory" })).toBeTruthy();
  setViewer("role_pending_access");
  expect(screen.getByRole("heading", { name: "Scouts directory" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Waiting for approval" })).toBeNull();
  expect(screen.getByRole("link", { name: "Scouts" })).toBeTruthy();
});

test("pending accounts retain account controls", async () => {
  setViewer("role_pending_access");
  await open("/settings");
  expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Your session" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  expect(screen.getByRole("link", { name: "Reviews" })).toBeTruthy();
});

test("credit history opens from settings and returns to the account", async () => {
  setViewer("role_member");
  await open("/settings");
  const user = userEvent.setup();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Credit history" })).toBeNull();
  await user.click(screen.getByRole("link", { name: "View credit history" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Credit history" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Credit activity", busy: true }).textContent).toBe("");
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  await user.click(screen.getByRole("link", { name: "Back to Settings" }));
  expect(await screen.findByRole("button", { name: "Sign out" })).toBeTruthy();
});

test("guests must sign in before opening credit history", async () => {
  remote.authenticated = false;
  await open("/credit-history");
  expect(await screen.findByRole("heading", { name: "Sign in to Scout" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Credit history" })).toBeNull();
});

test("staff keep Lab and settings admin access without approval", async () => {
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
  for (const name of ["Lab", "Sites", "Members"]) {
    expect(screen.queryByRole("link", { name })).toBeNull();
  }

  expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
  await user.click(screen.getByRole("link", { name: "Scouts" }));
  expect(await screen.findByRole("heading", { name: "Scouts directory" })).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Sign in" }));
  expect(await screen.findByRole("heading", { name: "Sign in to Scout" })).toBeTruthy();
  expect(screen.getByLabelText("Email")).toBeTruthy();
  expect(remote.lab).not.toHaveBeenCalled();
});

test("staff can mount Lab content before member approval", async () => {
  setViewer("role_staff", false);
  await open("/lab");
  expect(await screen.findByRole("heading", { name: "Lab contents" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
});

test.each(["deleting", "deleted"])(
  "%s accounts leave protected content for the deletion page",
  async (kind) => {
    setViewer("role_staff");
    await open("/lab");
    expect(await screen.findByRole("heading", { name: "Lab contents" })).toBeTruthy();
    act(() => {
      remote.values.set("viewer", { kind });
      remote.revision += 1;
      for (const listener of remote.subscribers) listener();
    });
    expect(await screen.findByRole("heading", { name: "Account deletion" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Lab contents" })).toBeNull();
  },
);

test.each([
  { path: "/", title: "Activity contents" },
  { path: "/about", title: "The internet is a confusing place." },
  { path: "/play", title: "Play contents" },
  { path: "/tasks/public-review", title: "Review contents" },
  { path: "/sites/example.com", title: "Site contents" },
  { path: "/privacy", title: "Privacy policy" },
  { path: "/terms", title: "Terms and conditions" },
])("$path is readable without signing in", async ({ path, title }) => {
  remote.authenticated = false;
  await open(path);
  expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
  expect(screen.queryByLabelText("Account access")).toBeNull();
});

// The shared access gate handles viewer state once; each route declares its policy above.
test.each([
  "auth_loading",
  "loading",
  "pending",
  "member",
  "staff",
  "deleting",
  "deleted",
  "terms_required",
])("public content remains readable for a %s viewer", async (state) => {
  switch (state) {
    case "auth_loading":
      remote.authenticated = false;
      remote.authLoading = true;
      break;
    case "pending":
      setViewer("role_pending_access");
      break;
    case "member":
      setViewer("role_member");
      break;
    case "staff":
      setViewer("role_staff");
      break;
    case "deleting":
    case "deleted":
    case "terms_required":
      remote.values.set("viewer", { kind: state });
      break;
  }
  await open("/");
  expect(await screen.findByRole("heading", { name: "Activity contents" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Account deletion" })).toBeNull();
  expect(screen.queryByLabelText("Account access")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Review our terms" })).toBeNull();
});

test("legal documents render tables, email links, and section anchors before the account query resolves", async () => {
  await open("/privacy");
  const heading = await screen.findByRole("heading", { name: "Who is responsible" });
  expect(heading.id).toBe("legal-who-is-responsible");
  expect(screen.getAllByRole("table")).toHaveLength(3);
  expect(screen.getByRole("columnheader", { name: "Legal basis" })).toBeTruthy();
  expect(
    screen.getAllByRole("link", { name: "contact@samebase.com" })[0].getAttribute("href"),
  ).toBe("mailto:contact@samebase.com");
  act(() => {
    remote.values.set("viewer", { kind: "deleted" });
    remote.revision += 1;
    for (const listener of remote.subscribers) listener();
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole("link", { name: "Terms and conditions" }));
  expect(
    await screen.findByRole("heading", { level: 1, name: "Terms and conditions" }),
  ).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Privacy policy" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Privacy policy" })).toBeTruthy();
});

test("guests can read policies from signup before submitting account information", async () => {
  remote.authenticated = false;
  await open("/settings");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Create account" }));
  expect(screen.getByRole("heading", { name: "Create account" })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: TERMS_ACCEPTANCE_LABEL })).toHaveProperty(
    "checked",
    false,
  );
  expect(screen.getByRole("link", { name: "Terms and conditions" }).getAttribute("href")).toBe(
    "/terms",
  );
  expect(screen.getByRole("link", { name: "Privacy policy" }).getAttribute("target")).toBe(
    "_blank",
  );
});

test("existing users explicitly accept before protected content mounts, and failed saves remain visible", async () => {
  remote.values.set("viewer", { kind: "terms_required", userId: "account" });
  await open("/lab");
  const user = userEvent.setup();
  expect(await screen.findByRole("heading", { name: "Review our terms" })).toBeTruthy();
  expect(remote.lab).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Accept and continue" }));
  expect(remote.accept).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox", { name: TERMS_ACCEPTANCE_LABEL }));
  remote.accept.mockRejectedValueOnce(new ConvexError("Acceptance could not be saved"));
  await user.click(screen.getByRole("button", { name: "Accept and continue" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Acceptance could not be saved");
  expect(remote.lab).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Accept and continue" }));
  expect(remote.accept).toHaveBeenLastCalledWith({});
  setViewer("role_staff");
  expect(await screen.findByRole("heading", { name: "Lab contents" })).toBeTruthy();
});

test("the homepage stays mounted as auth resolves, and terms are requested in account settings", async () => {
  remote.authenticated = false;
  remote.authLoading = true;
  await open("/");
  const content = await screen.findByRole("heading", { name: "Activity contents" });
  act(() => {
    remote.authLoading = false;
    remote.authenticated = true;
    remote.values.set("viewer", { kind: "terms_required", userId: "account" });
    remote.revision += 1;
    for (const listener of remote.subscribers) listener();
  });
  expect(screen.getByRole("heading", { name: "Activity contents" })).toBe(content);
  expect(screen.queryByRole("heading", { name: "Review our terms" })).toBeNull();
  const user = userEvent.setup();
  await user.click(screen.getByRole("link", { name: "Settings" }));
  expect(await screen.findByRole("heading", { name: "Review our terms" })).toBeTruthy();
  expect(remote.accept).not.toHaveBeenCalled();
});

test("a user can close an account without accepting terms", async () => {
  remote.values.set("viewer", { kind: "terms_required", userId: "account" });
  await open("/lab");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Close account" }));
  expect(await screen.findByRole("heading", { name: "Account deletion" })).toBeTruthy();
  expect(remote.accept).not.toHaveBeenCalled();
});

test("pending accounts can read the terms from Settings", async () => {
  setViewer("role_pending_access");
  await open("/settings");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Terms and conditions" }));
  expect(await screen.findByRole("heading", { name: "Terms and conditions" })).toBeTruthy();
});

test("guests can use the header legal menu with a keyboard", async () => {
  remote.authenticated = false;
  await open("/");
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "More options" });
  trigger.focus();
  await user.keyboard("{Enter}");
  const privacy = await screen.findByRole("menuitem", { name: "Privacy policy" });
  expect(document.activeElement).toBe(privacy);
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "Terms and conditions" }),
  );
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: "Privacy policy" }));
  expect(await screen.findByRole("heading", { name: "Privacy policy" })).toBeTruthy();
  expect(screen.queryByRole("menu")).toBeNull();
});
