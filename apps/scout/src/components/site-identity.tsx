import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { ArrowUpRightIcon } from "lucide-react";
import { cn } from "#lib/utils";

type Site = NonNullable<FunctionReturnType<typeof api.scout.sites.get>>;

export function SiteIdentity({
  site,
  heading: Heading,
}: {
  site: Site;
  heading: "h1" | "h2" | "span";
}) {
  const websiteLink = (
    <a
      href={site.profile?.homepageUrl ?? `https://${site.hostname}`}
      target="_blank"
      rel="noreferrer"
      className="relative z-20 inline-flex max-w-full items-center gap-1 rounded-sm align-top underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      title={site.hostname}
    >
      <span className="truncate">{site.hostname}</span>
      <ArrowUpRightIcon className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
  return (
    <div className="min-w-0 space-y-1">
      <Heading
        className={cn(
          "site-identity-name block font-semibold",
          Heading === "span"
            ? "truncate text-sm"
            : "text-2xl leading-tight tracking-tight wrap-anywhere",
          Heading === "h1" && "sm:text-3xl",
          Heading === "h2" && "truncate",
        )}
        title={site.profile === null ? site.hostname : site.profile.name}
      >
        {site.profile === null ? websiteLink : site.profile.name}
      </Heading>
      {site.profile !== null && (
        <p className="truncate text-sm font-normal text-muted-foreground" title={site.hostname}>
          {websiteLink}
        </p>
      )}
    </div>
  );
}
