// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { CreditBalanceLink, CreditsPanel } from "./credits-panel";
import type { api } from "../../convex/_generated/api";

const remote = vi.hoisted(() => {
  const state: {
    purchase: FunctionReturnType<typeof api.creditPurchases.status>;
  } = { purchase: null };
  return {
    ...state,
    balanceUnits: 500_000,
    walletMissing: false,
    approved: true,
    usageEnabled: true,
    checkoutEnabled: true,
    history: vi.fn(),
    historyStatus: "Exhausted",
    ensureWallet: vi.fn(),
    createCheckout: vi.fn(),
    loadMore: vi.fn(),
  };
});

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
              balanceUnits: remote.balanceUnits,
              hold: { kind: "clear" },
            };
      case "credits:offer":
        return {
          unitsPerCredit: 10_000,
          packCredits: 400,
          packPriceCents: 500,
          usageEnabled: remote.usageEnabled,
          checkoutEnabled: remote.checkoutEnabled,
        };
      case "creditPurchases:status":
        return remote.purchase;
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
  remote.balanceUnits = 500_000;
  remote.walletMissing = false;
  remote.approved = true;
  remote.usageEnabled = true;
  remote.checkoutEnabled = true;
  remote.purchase = null;
  remote.historyStatus = "Exhausted";
  remote.history.mockReset().mockReturnValue([]);
  remote.ensureWallet.mockReset().mockResolvedValue(null);
  remote.createCheckout.mockReset();
  remote.loadMore.mockReset();
});

afterEach(cleanup);

test("shows a compact balance and ledger history without reserved credits", () => {
  remote.balanceUnits = 456_789;
  remote.historyStatus = "CanLoadMore";
  remote.history.mockReturnValue([
    {
      _id: "entry-2",
      _creationTime: 1_700_000_100_000,
      amountUnits: -50_000,
      detail: { kind: "usage", usageKind: "model", sessionId: null, costMicrodollars: 50_000 },
    },
    {
      _id: "entry-1",
      _creationTime: 1_700_000_000_000,
      amountUnits: 500_000,
      detail: { kind: "signup", policyVersion: "2026-09-10" },
    },
  ]);

  render(<CreditsPanel purchaseId={undefined} />);

  expect(screen.getByText("45.7")).toBeTruthy();
  expect(screen.queryByText(/reserved|ongoing work/i)).toBeNull();
  expect(screen.queryByText("Add credits before starting new work.")).toBeNull();
  const history = screen.getByRole("list", { name: "Credit history" });
  expect(within(history).getByText("AI usage")).toBeTruthy();
  expect(within(history).getByText("-5")).toBeTruthy();
  expect(within(history).getByText("Signup credits")).toBeTruthy();
  expect(within(history).getByText("+50")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "More history" }));
  expect(remote.loadMore).toHaveBeenCalledWith(10);
});

test.each([
  [0, "0"],
  [-27_500, "-2.8"],
])("shows balance %s with top-up guidance", (balanceUnits, displayed) => {
  remote.balanceUnits = balanceUnits;
  render(<CreditsPanel purchaseId={undefined} />);

  expect(screen.getByText(displayed)).toBeTruthy();
  expect(screen.getByText("Add credits before starting new work.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add 400 credits for $5.00" })).toHaveProperty(
    "disabled",
    false,
  );
});

test.each([
  [12_345, "+1.23"],
  [-12_345, "-1.23"],
  [1, "+<0.01"],
  [-1, "-<0.01"],
  [99, "+<0.01"],
  [-99, "-<0.01"],
  [100, "+0.01"],
  [-100, "-0.01"],
  [0, "0"],
])("formats history amount %s as %s", (amountUnits, displayed) => {
  remote.history.mockReturnValue([
    {
      _id: "entry-1",
      _creationTime: 1_700_000_000_000,
      amountUnits,
      detail: { kind: "adjustment", reason: "Balance adjustment" },
    },
  ]);
  render(<CreditsPanel purchaseId={undefined} />);

  const history = screen.getByRole("list", { name: "Credit history" });
  expect(within(history).getByText(displayed)).toBeTruthy();
});

test("keeps the offer visible but disables checkout when purchases are unavailable", () => {
  remote.checkoutEnabled = false;
  render(<CreditsPanel purchaseId={undefined} />);

  expect(screen.getByRole("button", { name: "Add 400 credits for $5.00" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByText("Credit purchases are unavailable right now.")).toBeTruthy();
  expect(remote.createCheckout).not.toHaveBeenCalled();
});

test("hides the entire credits panel when usage is disabled", () => {
  remote.usageEnabled = false;
  remote.checkoutEnabled = false;
  const { container, rerender } = render(<CreditsPanel purchaseId={undefined} />);

  expect(container.firstChild).toBeNull();

  remote.walletMissing = true;
  rerender(<CreditsPanel purchaseId={undefined} />);
  expect(remote.ensureWallet).not.toHaveBeenCalled();
});

test("requires account approval to buy credits", () => {
  remote.approved = false;
  render(<CreditsPanel purchaseId={undefined} />);

  expect(screen.getByRole("button", { name: /Add 400 credits/ })).toHaveProperty("disabled", true);
  expect(screen.getByText("Account approval is required to buy credits.")).toBeTruthy();
});

test("creates a missing wallet and reports setup errors", async () => {
  remote.walletMissing = true;
  remote.ensureWallet.mockRejectedValue(new Error("Wallet unavailable"));
  render(<CreditsPanel purchaseId={undefined} />);

  await waitFor(() => expect(remote.ensureWallet).toHaveBeenCalledWith({}));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Could not load your credits. Refresh to try again.",
  );
});

test("lets a failed checkout be retried", async () => {
  remote.createCheckout.mockRejectedValue(new Error("Polar unavailable"));
  render(<CreditsPanel purchaseId={undefined} />);

  const button = screen.getByRole("button", { name: /Add 400 credits/ });
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Could not open checkout. Try again.",
  );
  fireEvent.click(button);
  await waitFor(() => expect(remote.createCheckout).toHaveBeenCalledTimes(2));
});

test("shows payment confirmation after returning from checkout", () => {
  remote.purchase = "paid";
  render(<CreditsPanel purchaseId="purchase-1" />);

  expect(screen.getByRole("status")).toHaveProperty(
    "textContent",
    "Payment confirmed. Credits were added to your balance.",
  );
});

test("updates the return page from pending through payment and refunds", () => {
  remote.purchase = "pending";
  const { rerender } = render(<CreditsPanel purchaseId="purchase-1" />);
  expect(screen.getByRole("status").textContent).toContain("Waiting for payment confirmation");

  remote.purchase = "paid";
  rerender(<CreditsPanel purchaseId="purchase-1" />);
  expect(screen.getByRole("status").textContent).toContain("Payment confirmed");

  remote.purchase = "partially_refunded";
  rerender(<CreditsPanel purchaseId="purchase-1" />);
  expect(screen.getByRole("status").textContent).toContain("partially refunded");

  remote.purchase = "refunded";
  rerender(<CreditsPanel purchaseId="purchase-1" />);
  expect(screen.getByRole("status").textContent).toBe(
    "Your payment was refunded. No credits remain from this purchase.",
  );
  expect(screen.queryByText(/Waiting for payment confirmation/)).toBeNull();
});

test("gives a concrete next step for a payment needing review", () => {
  remote.purchase = "needs_review";
  render(<CreditsPanel purchaseId="purchase-1" />);
  expect(screen.getByRole("status").textContent).toBe(
    "Your payment needs review. Contact an admin with this page’s link.",
  );
});

test("distinguishes checkout failure from pending payment", () => {
  remote.purchase = "checkout_failed";
  render(<CreditsPanel purchaseId="purchase-1" />);
  expect(screen.getByRole("status").textContent).toBe(
    "Checkout could not be opened. Try buying credits again.",
  );
});

test.each([
  [500_000, "50"],
  [499_999, "49"],
  [9_999, "0"],
  [0, "0"],
  [-27_500, "-2.8"],
  [-1_000, "-0.1"],
  [-200, "-<0.1"],
])("links compact header balance %s to settings", async (balanceUnits, displayed) => {
  remote.balanceUnits = balanceUnits;
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
  const balance = await screen.findByRole("link", {
    name: `${displayed} credits. View credit history in settings.`,
  });
  expect(balance.textContent).toBe(`${displayed} credits`);
  expect(balance.getAttribute("href")).toBe("/settings");
  fireEvent.click(balance);
  expect(await screen.findByText("Settings page")).toBeTruthy();
});

test("hides the navigation balance when usage is disabled", () => {
  remote.usageEnabled = false;
  const { container } = render(<CreditBalanceLink />);

  expect(container.firstChild).toBeNull();
});
