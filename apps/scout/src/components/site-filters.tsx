import { useEffect, useEffectEvent, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/ui/select";
import { useViewerAccess } from "#lib/access";
import { reviewFeedSearch, type ReviewFeedSearch } from "#lib/reviewFeedSearch";
import { cn } from "#lib/utils";
import { siteSearchSchema } from "../../shared/site";

export function SiteFilters({
  search,
  layout,
  reviewedSiteCount,
  onChange,
}: {
  search: ReviewFeedSearch;
  layout: "toolbar" | "sidebar";
  reviewedSiteCount: FunctionReturnType<typeof api.scout.sites.count> | undefined;
  onChange: (search: ReviewFeedSearch, options: { replace: boolean }) => void;
}) {
  const viewer = useViewerAccess();
  const [draft, setDraft] = useState(search.site ?? "");
  useEffect(() => {
    setDraft(search.site ?? "");
  }, [search.site]);
  const signedIn = viewer?.kind === "account";
  const scope = signedIn ? (search.scope ?? "public") : "public";
  const applySearch = useEffectEvent((site: string | undefined) => {
    onChange({ scope, site }, { replace: true });
  });
  useEffect(() => {
    const site = siteSearchSchema.parse(draft) || undefined;
    if (site === search.site) return;
    const timeout = setTimeout(() => applySearch(site), 300);
    return () => clearTimeout(timeout);
  }, [draft, search.site]);

  return (
    <div className="@container/site-filters">
      <div className="flex flex-col gap-2 @min-[500px]/site-filters:flex-row @min-[500px]/site-filters:flex-wrap @min-[500px]/site-filters:items-center @min-[500px]/site-filters:justify-between @min-[500px]/site-filters:gap-3">
        <div
          aria-busy={reviewedSiteCount === undefined}
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1",
            layout === "sidebar"
              ? "min-h-5 justify-between @min-[500px]/site-filters:min-h-11 @min-[500px]/site-filters:justify-start"
              : "min-h-11",
          )}
        >
          {signedIn && (
            <Select
              value={scope}
              onValueChange={(value) =>
                onChange(
                  { site: search.site, scope: reviewFeedSearch.shape.scope.parse(value) },
                  { replace: false },
                )
              }
            >
              <SelectTrigger
                aria-label="Review visibility"
                className="min-h-11 min-w-40 shrink-0 bg-card"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="public">Public reviews</SelectItem>
                <SelectItem value="mine">My reviews</SelectItem>
              </SelectContent>
            </Select>
          )}
          {reviewedSiteCount !== undefined && (
            <span
              className={cn(
                "whitespace-nowrap text-muted-foreground",
                layout === "sidebar" ? "text-xs" : "text-sm",
              )}
            >
              {reviewedSiteCount.count.toLocaleString()}
              {reviewedSiteCount.hasMore ? "+" : ""}
              {layout === "toolbar" ? " reviewed " : " "}
              {reviewedSiteCount.count === 1 ? "site" : "sites"}
            </span>
          )}
        </div>
        <div className="relative w-full min-w-0 max-w-full @min-[500px]/site-filters:ml-auto @min-[500px]/site-filters:w-64">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Filter by site"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search sites"
            className="min-h-11 w-full bg-card pr-9 pl-9"
          />
          {draft && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
              aria-label="Clear site filter"
              onClick={() => {
                setDraft("");
                onChange({ scope, site: undefined }, { replace: true });
              }}
            >
              <XIcon aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
