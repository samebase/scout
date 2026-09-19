import { Badge } from "#components/ui/badge";

export function ScoutBadge({ name }: { name: string }) {
  return (
    <Badge
      variant="secondary"
      className="h-auto min-h-5 max-w-full font-normal whitespace-normal wrap-anywhere text-muted-foreground"
    >
      <span className="sr-only">Scout: </span>
      {name}
    </Badge>
  );
}
