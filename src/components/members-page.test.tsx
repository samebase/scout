// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { Route as MembersRoute } from "../routes/members";

type ListedMember = FunctionReturnType<typeof api.accounts.list>["page"][number];
type MemberFixture = Omit<ListedMember, "userId"> & { userId: string };

const remote = vi.hoisted<{
  accounts: MemberFixture[];
  loadMore: Mock;
  setApproval: Mock;
}>(() => ({
  accounts: [],
  loadMore: vi.fn(),
  setApproval: vi.fn(),
}));

vi.mock("convex/react", () => ({
  usePaginatedQuery: (reference: FunctionReference<"query">) => {
    const name = getFunctionName(reference);
    if (name !== "accounts:list") throw new Error("Unexpected query: " + name);
    return {
      results: remote.accounts,
      status: "Exhausted",
      loadMore: remote.loadMore,
    };
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference);
    if (name !== "accounts:setApproval") throw new Error("Unexpected mutation: " + name);
    return remote.setApproval;
  },
}));

beforeEach(() => {
  remote.accounts = [
    {
      userId: "staff",
      role: "role_staff",
      isApproved: false,
      email: "nicu.dev@gmail.com",
      verified: true,
    },
    {
      userId: "pending",
      role: "role_pending_access",
      isApproved: false,
      email: "pending@example.test",
      verified: true,
    },
    {
      userId: "member",
      role: "role_member",
      isApproved: true,
      email: "member@example.test",
      verified: true,
    },
  ];
  remote.loadMore.mockReset();
  remote.setApproval.mockReset().mockResolvedValue(null);
});

afterEach(cleanup);

async function openMembers() {
  const component = MembersRoute.options.component;
  if (!component) throw new Error("Members route configuration is missing");

  const root = createRootRoute({ staticData: { access: "access_public" } });
  const members = createRoute({
    getParentRoute: () => root,
    path: "/members",
    staticData: { access: "access_members_manage" },
    component,
  });
  const router = createRouter({
    routeTree: root.addChildren([members]),
    history: createMemoryHistory({ initialEntries: ["/members"] }),
  });

  render(<RouterProvider router={router} />);
  await router.load();
}

function rowFor(email: string) {
  const row = screen.getByText(email).closest("tr");
  if (!(row instanceof HTMLElement)) throw new Error("Member row missing for " + email);
  return row;
}

test("members can be approved or revoked without role or suspension controls", async () => {
  const user = userEvent.setup();
  await openMembers();

  expect(await screen.findByRole("heading", { name: "Members" })).toBeTruthy();
  expect(screen.queryByRole("columnheader", { name: "Role" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();

  const staffRow = rowFor("nicu.dev@gmail.com");
  expect(within(staffRow).getByText("Admin, approval not required")).toBeTruthy();
  expect(within(staffRow).queryByRole("button")).toBeNull();

  const pendingRow = rowFor("pending@example.test");
  expect(within(pendingRow).getByText("Pending")).toBeTruthy();
  await user.click(within(pendingRow).getByRole("button", { name: "Approve" }));

  const memberRow = rowFor("member@example.test");
  expect(within(memberRow).getByText("Approved")).toBeTruthy();
  await user.click(within(memberRow).getByRole("button", { name: "Revoke approval" }));

  await waitFor(() => expect(remote.setApproval).toHaveBeenCalledTimes(2));
  expect(remote.setApproval).toHaveBeenNthCalledWith(1, {
    userId: "pending",
    isApproved: true,
  });
  expect(remote.setApproval).toHaveBeenNthCalledWith(2, {
    userId: "member",
    isApproved: false,
  });

  expect(screen.queryByRole("button", { name: /promote/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /admin/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /suspend/i })).toBeNull();
});
