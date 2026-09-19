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

export function SiteFilters(
  props: {
    search: ReviewFeedSearch;
    onChange: (search: ReviewFeedSearch, options: { replace: boolean }) => void;
  } & (
    | {
        layout: "toolbar";
        reviewedSiteCount: FunctionReturnType<typeof api.scout.sites.count> | undefined;
      }
    | { layout: "sidebar" }
  ),
) {
  const { search, layout, onChange } = props;
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
    <div
      className={cn(
        "flex gap-2",
        layout === "sidebar"
          ? "flex-col"
          : "flex-wrap items-center justify-between gap-3 max-[500px]:flex-col max-[500px]:items-stretch",
      )}
    >
      {(signedIn || layout === "toolbar") && (
        <div
          className={cn("flex flex-wrap items-center gap-3", layout === "toolbar" && "min-h-11")}
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
                className={cn(
                  "min-h-11 bg-card",
                  layout === "sidebar" ? "w-full" : "min-w-40 shrink-0",
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="public">Public reviews</SelectItem>
                <SelectItem value="mine">My reviews</SelectItem>
              </SelectContent>
            </Select>
          )}
          {props.layout === "toolbar" && props.reviewedSiteCount !== undefined && (
            <span className="text-sm whitespace-nowrap text-muted-foreground">
              {props.reviewedSiteCount.count.toLocaleString()}
              {props.reviewedSiteCount.hasMore ? "+" : ""} reviewed{" "}
              {props.reviewedSiteCount.count === 1 ? "site" : "sites"}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          "relative min-w-0",
          layout === "toolbar" && "ml-auto w-64 max-w-full max-[500px]:ml-0 max-[500px]:w-full",
        )}
      >
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
  );
}
