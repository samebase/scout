// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { CreditBalanceLink, CreditsPanel } from "./credits-panel";

const remote = vi.hoisted(() => ({
  availableUnits: 500_000,
  reservedUnits: 0,
  walletMissing: false,
  approved: true,
  checkoutEnabled: true,
  history: vi.fn(),
  historyStatus: "Exhausted",
  ensureWallet: vi.fn(),
  createCheckout: vi.fn(),
  loadMore: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (reference: FunctionReference<"query">) => {
    switch (getFunctionName(reference)) {
      case "accounts:currentViewerAccess":
        return {
          kind: "account",
          accessKeys: remote.approved ? ["access_play"] : ["access_account"],
        };
      case "credits:balance":
        return remote.walletMissing
          ? null
          : {
              availableUnits: remote.availableUnits,
              reservedUnits: remote.reservedUnits,
              hold: { kind: "clear" },
            };
      case "credits:offer":
        return {
          unitsPerCredit: 10_000,
          packCredits: 200,
          packPriceCents: 500,
          checkoutEnabled: remote.checkoutEnabled,
        };
      default:
        throw new Error(`Unexpected query: ${getFunctionName(reference)}`);
    }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    if (getFunctionName(reference) !== "credits:ensureWallet")
      throw new Error(`Unexpected mutation: ${getFunctionName(reference)}`);
    return remote.ensureWallet;
  },
  useAction: (reference: FunctionReference<"action">) => {
    if (getFunctionName(reference) !== "polar:checkout")
      throw new Error(`Unexpected action: ${getFunctionName(reference)}`);
    return remote.createCheckout;
  },
  usePaginatedQuery: (reference: FunctionReference<"query">) => {
    if (getFunctionName(reference) !== "credits:history")
      throw new Error(`Unexpected paginated query: ${getFunctionName(reference)}`);
    return {
      results: remote.history(),
      status: remote.historyStatus,
      loadMore: remote.loadMore,
    };
  },
}));

beforeEach(() => {
  remote.availableUnits = 500_000;
  remote.reservedUnits = 0;
  remote.walletMissing = false;
  remote.approved = true;
  remote.checkoutEnabled = true;
  remote.historyStatus = "Exhausted";
  remote.history.mockReset().mockReturnValue([]);
  remote.ensureWallet.mockReset().mockResolvedValue(null);
  remote.createCheckout.mockReset();
  remote.loadMore.mockReset();
});

afterEach(cleanup);

test("shows available and reserved credits with ledger history", () => {
  remote.availableUnits = 450_000;
  remote.reservedUnits = 50_000;
  remote.historyStatus = "CanLoadMore";
  remote.history.mockReturnValue([
    {
      _id: "entry-2",
      _creationTime: 1_700_000_100_000,
      amountUnits: -50_000,
      detail: { kind: "usage", costMicrodollars: 50_000 },
    },
    {
      _id: "entry-1",
      _creationTime: 1_700_000_000_000,
      amountUnits: 500_000,
      detail: { kind: "signup", policyVersion: "2026-09-10" },
    },
  ]);

  render(<CreditsPanel />);

  expect(screen.getByText("45")).toBeTruthy();
  expect(screen.getByText(/5 reserved for ongoing work/)).toBeTruthy();
  const history = screen.getByRole("list", { name: "Credit history" });
  expect(within(history).getByText("AI and web usage")).toBeTruthy();
  expect(within(history).getByText("-5")).toBeTruthy();
  expect(within(history).getByText("Signup credits")).toBeTruthy();
  expect(within(history).getByText("+50")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "More history" }));
  expect(remote.loadMore).toHaveBeenCalledWith(10);
});

test("keeps the offer visible but disables checkout when purchases are unavailable", () => {
  remote.checkoutEnabled = false;
  render(<CreditsPanel />);

  expect(screen.getByRole("button", { name: "Add 200 credits for $5.00" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByText("Credit purchases are unavailable right now.")).toBeTruthy();
  expect(remote.createCheckout).not.toHaveBeenCalled();
});

test("requires account approval to buy credits", () => {
  remote.approved = false;
  render(<CreditsPanel />);

  expect(screen.getByRole("button", { name: /Add 200 credits/ })).toHaveProperty("disabled", true);
  expect(screen.getByText("Account approval is required to buy credits.")).toBeTruthy();
});

test("creates a missing wallet and reports setup errors", async () => {
  remote.walletMissing = true;
  remote.ensureWallet.mockRejectedValue(new Error("Wallet unavailable"));
  render(<CreditsPanel />);

  await waitFor(() => expect(remote.ensureWallet).toHaveBeenCalledWith({}));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Could not load your credits. Refresh to try again.",
  );
});

test("lets a failed checkout be retried", async () => {
  remote.createCheckout.mockRejectedValue(new Error("Polar unavailable"));
  render(<CreditsPanel />);

  const button = screen.getByRole("button", { name: /Add 200 credits/ });
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Could not open checkout. Try again.",
  );
  fireEvent.click(button);
  await waitFor(() => expect(remote.createCheckout).toHaveBeenCalledTimes(2));
});

test("links the navigation balance to settings", async () => {
  const root = createRootRoute({ staticData: { access: "access_public" } });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    staticData: { access: "access_public" },
    component: CreditBalanceLink,
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    staticData: { access: "access_account" },
    component: () => <p>Settings page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, settings]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(<RouterProvider router={router} />);
  const balance = await screen.findByRole("link", { name: /50 credits available/ });
  expect(balance.getAttribute("href")).toBe("/settings");
  fireEvent.click(balance);
  expect(await screen.findByText("Settings page")).toBeTruthy();
});
