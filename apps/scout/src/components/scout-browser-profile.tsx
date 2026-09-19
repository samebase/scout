import { useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "#components/ui/button";

export function ScoutBrowserProfile({
  scoutId,
  profileName,
  summary,
}: {
  scoutId: Id<"scouts">;
  profileName: string;
  summary: NonNullable<
    FunctionReturnType<typeof api.scout.scouts.resources>
  >["browserProfileSummary"];
}) {
  const refresh = useAction(api.scout.browserProfiles.refresh);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await refresh({ scoutId });
    } catch (failure) {
      const detail = failure instanceof ConvexError ? z.string().safeParse(failure.data) : null;
      setError(
        detail?.success
          ? detail.data
          : failure instanceof Error
            ? failure.message
            : "Could not refresh browser profile.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="min-w-0" aria-busy={refreshing}>
      <dt className="text-muted-foreground text-xs">Firecrawl profile</dt>
      <dd className="mt-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="wrap-break-word">{profileName}</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {summary ? (
          <>
            <p className="mt-2 tabular-nums">
              {summary.cookieCount.toLocaleString()} saved{" "}
              {summary.cookieCount === 1 ? "cookie" : "cookies"}
              {" · "}
              {summary.cookieDomainCount.toLocaleString()}{" "}
              {summary.cookieDomainCount === 1 ? "domain" : "domains"}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Checked{" "}
              <time dateTime={new Date(summary.checkedAt).toISOString()}>
                {new Date(summary.checkedAt).toLocaleString()}
              </time>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground mt-2 text-xs">Saved cookies not checked yet.</p>
        )}
        {error && (
          <p role="alert" className="text-destructive mt-2 text-xs wrap-break-word">
            {error}
          </p>
        )}
      </dd>
    </div>
  );
}
