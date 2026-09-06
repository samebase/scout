import { createFileRoute } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/members")({
  staticData: { access: "access_members_manage" },
  head: () => ({ meta: [{ title: "Members | Scout" }] }),
  component: MembersPage,
});

function MembersPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.accounts.list,
    {},
    { initialNumItems: 30 },
  );
  return (
    <main className="route-page max-w-6xl">
      <h1 className="route-heading">Members</h1>
      <p className="mt-3 text-muted-foreground">
        Approve new accounts and manage roles and access.
      </p>
      <div className="surface-panel mt-8 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-4">Account</th>
              <th className="p-4">Role</th>
              <th className="p-4">Approval</th>
              <th className="p-4">Status</th>
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {results.map((account) => (
              <MemberRow key={account.userId} account={account} />
            ))}
          </tbody>
        </table>
        {status === "LoadingFirstPage" && (
          <p className="p-4" role="status">
            Loading members…
          </p>
        )}
        {status === "Exhausted" && results.length === 0 && <p className="p-4">No accounts yet.</p>}
      </div>
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          className="mt-4"
          variant="outline"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(30)}
        >
          {status === "LoadingMore" ? "Loading…" : "Load more"}
        </Button>
      )}
    </main>
  );
}

function MemberRow({
  account,
}: {
  account: FunctionReturnType<typeof api.accounts.list>["page"][number];
}) {
  const changeAccess = useMutation(api.accounts.changeAccess);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function change(change: FunctionArgs<typeof api.accounts.changeAccess>["change"]) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await changeAccess({
        userId: account.userId,
        change,
      });
    } catch (caught) {
      setError(
        caught instanceof ConvexError && typeof caught.data === "string"
          ? caught.data
          : "Could not update access. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <tr className="border-b last:border-0">
      <td className="p-4">
        <span>{account.email ?? "No email"}</span>
        {!account.verified && (
          <span className="block text-xs text-muted-foreground">Unverified</span>
        )}
      </td>
      <td className="p-4">{account.role === "role_admin" ? "Admin" : "Member"}</td>
      <td className="p-4">{account.isApproved ? "Approved" : "Pending"}</td>
      <td className="p-4">{account.status === "active" ? "Active" : "Suspended"}</td>
      <td className="p-4">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={account.isApproved ? "outline" : "default"}
            disabled={pending || (!account.isApproved && !account.verified)}
            onClick={() => {
              void change({ kind: "approval", isApproved: !account.isApproved });
            }}
          >
            {account.isApproved ? "Revoke approval" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={
              pending ||
              (account.role === "role_member" && (!account.verified || !account.isApproved))
            }
            onClick={() => {
              void change({
                kind: "role",
                role: account.role === "role_admin" ? "role_member" : "role_admin",
              });
            }}
          >
            {account.role === "role_admin" ? "Make member" : "Make admin"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              void change({
                kind: "status",
                status: account.status === "active" ? "suspended" : "active",
              });
            }}
          >
            {account.status === "active" ? "Suspend" : "Reactivate"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-destructive">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}
