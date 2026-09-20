import { createFileRoute } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/members")({
  ssr: false,
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
    <main className="route-page">
      <h1 className="route-heading">Members</h1>
      <p className="mt-3 text-muted-foreground">Approve or revoke member access.</p>
      <div
        className="surface-panel mt-8 min-h-40 overflow-x-auto"
        aria-busy={status === "LoadingFirstPage" || status === "LoadingMore"}
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-4">Account</th>
              <th className="p-4">Approval</th>
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {results.map((account) => (
              <MemberRow key={account.userId} account={account} />
            ))}
          </tbody>
        </table>
        {status === "Exhausted" && results.length === 0 && <p className="p-4">No accounts yet.</p>}
      </div>
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          className="mt-4"
          variant="outline"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(30)}
        >
          Load more
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
  const setApproval = useMutation(api.accounts.setApproval);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function changeApproval() {
    if (pending || account.kind !== "active") return;
    setPending(true);
    setError("");
    try {
      await setApproval({
        userId: account.userId,
        isApproved: !account.isApproved,
      });
    } catch (caught) {
      setError(
        caught instanceof ConvexError && typeof caught.data === "string"
          ? caught.data
          : "Could not update approval. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  if (account.kind !== "active")
    return (
      <tr className="border-b last:border-0">
        <td className="p-4">
          {account.kind === "deleted" ? "Deleted account" : (account.email ?? "No email")}
        </td>
        <td className="p-4">{account.kind === "deleted" ? "Deleted" : "Deleting"}</td>
        <td className="p-4" />
      </tr>
    );
  return (
    <tr className="border-b last:border-0">
      <td className="p-4">
        <span>{account.email ?? "No email"}</span>
        {!account.verified && (
          <span className="block text-xs text-muted-foreground">Unverified</span>
        )}
      </td>
      <td className="p-4">
        {account.role === "role_staff"
          ? "Admin, approval not required"
          : account.isApproved
            ? "Approved"
            : "Pending"}
      </td>
      <td className="p-4">
        {account.role !== "role_staff" && (
          <Button
            size="sm"
            variant={account.isApproved ? "outline" : "default"}
            disabled={pending}
            onClick={() => {
              void changeApproval();
            }}
          >
            {account.isApproved ? "Revoke approval" : "Approve"}
          </Button>
        )}
        {error && (
          <p role="alert" className="mt-2 text-destructive">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}
