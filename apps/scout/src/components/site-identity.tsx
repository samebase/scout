import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { cn } from "#lib/utils";

type Site = FunctionReturnType<typeof api.scout.sites.list>["page"][number];

const researchLabels: Record<NonNullable<Site["research"]>["status"], string> = {
  running: "Researching…",
  waiting: "Waiting for research…",
  completed: "Research completed",
  failed: "Research failed",
  cancelled: "Research cancelled",
  skipped: "Research skipped",
};

export function SiteIdentity({
  site,
  heading: Heading,
}: {
  site: Site;
  heading: "h1" | "h2" | "span";
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Heading
        className={cn(
          "block font-semibold",
          Heading === "span"
            ? "truncate text-sm"
            : "text-2xl leading-tight tracking-tight wrap-anywhere",
          Heading === "h1" && "sm:text-3xl",
          Heading === "h2" && "group-hover:underline",
        )}
        title={site.profile === null ? site.hostname : site.profile.name}
      >
        {site.profile === null ? site.hostname : site.profile.name}
      </Heading>
      {site.profile !== null ? (
        <p className="truncate text-sm font-normal text-muted-foreground" title={site.hostname}>
          {site.hostname}
        </p>
      ) : (
        <p className="text-xs font-normal text-muted-foreground">
          {site.research === null ? "Not researched" : researchLabels[site.research.status]}
        </p>
      )}
    </div>
  );
}
