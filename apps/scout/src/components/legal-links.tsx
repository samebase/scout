import { Link } from "@tanstack/react-router";

export function LegalLinks() {
  return (
    <nav aria-label="Legal" className="flex flex-wrap gap-x-6 text-sm text-muted-foreground">
      <Link
        to="/privacy"
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring aria-[current=page]:text-foreground aria-[current=page]:underline"
      >
        Privacy policy
      </Link>
      <Link
        to="/terms"
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring aria-[current=page]:text-foreground aria-[current=page]:underline"
      >
        Terms and conditions
      </Link>
    </nav>
  );
}
