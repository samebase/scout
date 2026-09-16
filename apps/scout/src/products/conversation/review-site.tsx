import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { siteHostnameSchema } from "../../../shared/site";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { cn } from "#lib/utils";
import { playTextLink } from "./ui";

export function ReviewSite({
  threadId,
  site,
  canEdit,
  visibility,
}: {
  threadId: string;
  site: string | null;
  canEdit: boolean;
  visibility: "public" | "private";
}) {
  const setSite = useMutation(api.scout.reviewSites.set);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = siteHostnameSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setSite({ threadId, site: parsed.data });
      setEditing(false);
    } catch {
      setError("Couldn't save the site. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (editing)
    return (
      <form
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <Input
          aria-label="Review site"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="samebase.com"
          autoFocus
          disabled={saving}
          className="w-64 max-w-full"
        />
        <Button type="submit" disabled={saving}>
          Save
        </Button>
        <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {error && (
          <p role="alert" className="w-full text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    );

  return (
    <div className="flex min-w-0 items-center gap-1 text-sm">
      {site ? (
        <Link
          to="/sites/$site"
          params={{ site }}
          search={{ scope: visibility === "private" ? "mine" : "public", view: "tasks" }}
          className={cn(playTextLink, "min-h-11 min-w-0 text-muted-foreground")}
        >
          <ArrowLeftIcon size={16} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{site} tasks</span>
        </Link>
      ) : (
        <Link
          to="/"
          search={{ scope: visibility === "private" ? "mine" : "public" }}
          className={cn(playTextLink, "min-h-11 whitespace-nowrap text-muted-foreground")}
        >
          <ArrowLeftIcon size={16} aria-hidden="true" />
          All sites
        </Link>
      )}
      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          size={site ? "icon-sm" : "sm"}
          aria-label={site ? "Edit review site" : "Set review site"}
          onClick={() => {
            setDraft(site ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          {site ? <PencilIcon aria-hidden="true" /> : "Set site"}
        </Button>
      )}
    </div>
  );
}
