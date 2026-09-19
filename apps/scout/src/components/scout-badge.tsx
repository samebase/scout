import { Badge } from "#components/ui/badge";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

type Scout = Pick<FunctionReturnType<typeof api.scout.scouts.list>[number], "displayName" | "slug">;

export function ScoutBadge({ scout }: { scout: Scout }) {
  return (
    <Badge
      variant="secondary"
      asChild
      className="relative z-10 h-auto min-h-5 max-w-full font-normal whitespace-normal wrap-anywhere text-muted-foreground hover:text-foreground"
    >
      <Link to="/scouts/$slug" params={{ slug: scout.slug }}>
        <span className="sr-only">Scout: </span>
        {scout.displayName}
      </Link>
    </Badge>
  );
}
