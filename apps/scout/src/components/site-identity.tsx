import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { cn } from "#lib/utils";

type Site = NonNullable<FunctionReturnType<typeof api.scout.sites.get>>;

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
      {site.profile !== null && (
        <p className="truncate text-sm font-normal text-muted-foreground" title={site.hostname}>
          {site.hostname}
        </p>
      )}
    </div>
  );
}
