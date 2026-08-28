import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";

export const Route = createFileRoute("/scouts/")({
  component: ScoutsIndexPage,
});

type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];
type ScoutStatus = Scout["status"];

type RegistrationFields = {
  displayName: string;
  slug: string;
  address: string;
  inboxId: string;
  profileName: string;
};

type RegistrationState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };

const EMPTY_REGISTRATION: RegistrationFields = {
  displayName: "",
  slug: "",
  address: "",
  inboxId: "",
  profileName: "",
};

function ScoutsIndexPage() {
  const scouts = useQuery(api.scout.scouts.list);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationSubmitting, setRegistrationSubmitting] = useState(false);
  const registrationButton = useRef<HTMLButtonElement>(null);

  const closeRegistration = () => {
    if (registrationSubmitting) {
      return;
    }
    setRegistrationOpen(false);
    requestAnimationFrame(() => registrationButton.current?.focus());
  };

  return (
    <>
      <header className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
            Registry
          </p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">Scouts</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Configured scouts and the services attached to them.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {scouts === undefined ? "Loading scouts..." : `Showing ${scouts.length}`}
          </p>
          <Button
            ref={registrationButton}
            type="button"
            size="sm"
            aria-expanded={registrationOpen}
            aria-controls="register-scout-panel"
            disabled={registrationSubmitting}
            onClick={() => setRegistrationOpen((open) => !open)}
          >
            {registrationOpen ? <XIcon /> : <PlusIcon />}
            {registrationOpen ? "Close" : "Register scout"}
          </Button>
        </div>
      </header>

      {registrationOpen ? (
        <ScoutRegistrationForm
          onCancel={closeRegistration}
          onSubmittingChange={setRegistrationSubmitting}
        />
      ) : null}

      {scouts === undefined ? (
        <p
          className="text-muted-foreground rounded-xl border px-4 py-10 text-center text-sm"
          role="status"
        >
          Loading scouts...
        </p>
      ) : scouts.length === 0 ? (
        <div className="rounded-xl border px-4 py-10 text-center">
          <p className="text-sm font-medium">No scouts are registered yet.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Register an AgentMail inbox and Firecrawl profile to give Lab a reusable identity.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label="Scouts">
          {scouts.map((scout) => (
            <li key={scout._id}>
              <Link
                to="/scouts/$slug"
                params={{ slug: scout.slug }}
                className="group block rounded-xl p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <h2 className="wrap-break-word text-base font-medium group-hover:underline group-hover:underline-offset-4">
                      {scout.displayName}
                    </h2>
                    <p className="text-muted-foreground mt-1 font-mono text-xs">/{scout.slug}</p>
                  </div>
                  <ScoutStatus status={scout.status} />
                </div>

                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">AgentMail address</dt>
                    <dd className="mt-1 wrap-break-word">{scout.agentMail.address}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Firecrawl profile</dt>
                    <dd className="mt-1 wrap-break-word">{scout.firecrawl.profileName}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ScoutRegistrationForm({
  onCancel,
  onSubmittingChange,
}: {
  onCancel: () => void;
  onSubmittingChange: (submitting: boolean) => void;
}) {
  const registerScout = useMutation(api.scout.scouts.register);
  const navigate = useNavigate();
  const [fields, setFields] = useState<RegistrationFields>(EMPTY_REGISTRATION);
  const [slugEdited, setSlugEdited] = useState(false);
  const [state, setState] = useState<RegistrationState>({ kind: "idle" });
  const submitting = state.kind === "submitting";

  const updateField = <Key extends keyof RegistrationFields>(
    key: Key,
    value: RegistrationFields[Key],
  ) => {
    setFields((current) => ({ ...current, [key]: value }));
    if (state.kind === "failed") {
      setState({ kind: "idle" });
    }
  };

  const onDisplayNameChange = (displayName: string) => {
    setFields((current) => ({
      ...current,
      displayName,
      ...(slugEdited ? {} : { slug: slugFromDisplayName(displayName) }),
    }));
    if (state.kind === "failed") {
      setState({ kind: "idle" });
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setState({ kind: "submitting" });
    onSubmittingChange(true);
    try {
      const slug = fields.slug.trim().toLowerCase();
      const address = fields.address.trim();
      await registerScout({
        displayName: fields.displayName,
        slug,
        agentMail: {
          address,
          inboxId: fields.inboxId.trim() || address,
        },
        firecrawl: { profileName: fields.profileName },
      });
      await navigate({ to: "/scouts/$slug", params: { slug } });
    } catch (error) {
      onSubmittingChange(false);
      setState({ kind: "failed", message: registrationError(error) });
    }
  };

  return (
    <section
      id="register-scout-panel"
      className="bg-card rounded-xl border p-4 sm:p-5"
      aria-labelledby="register-scout-heading"
    >
      <div>
        <h2 id="register-scout-heading" className="text-lg font-medium">
          Register scout
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect one existing AgentMail inbox to one persistent Firecrawl profile.
        </p>
      </div>

      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <FormField label="Display name" htmlFor="scout-display-name">
          <Input
            id="scout-display-name"
            name="displayName"
            value={fields.displayName}
            autoComplete="off"
            placeholder="Conrad"
            autoFocus
            required
            maxLength={100}
            disabled={submitting}
            onChange={(event) => onDisplayNameChange(event.currentTarget.value)}
          />
        </FormField>
        <FormField label="Slug" htmlFor="scout-slug" hint="Lowercase letters, numbers, hyphens">
          <Input
            id="scout-slug"
            aria-describedby="scout-slug-hint"
            name="slug"
            value={fields.slug}
            autoComplete="off"
            placeholder="conrad"
            required
            maxLength={100}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            disabled={submitting}
            onChange={(event) => {
              setSlugEdited(true);
              updateField("slug", event.currentTarget.value.toLowerCase());
            }}
          />
        </FormField>
        <FormField label="AgentMail address" htmlFor="scout-agentmail-address">
          <Input
            id="scout-agentmail-address"
            name="agentMailAddress"
            type="email"
            value={fields.address}
            autoComplete="off"
            placeholder="conrad@agentmail.to"
            required
            maxLength={320}
            disabled={submitting}
            onChange={(event) => updateField("address", event.currentTarget.value)}
          />
        </FormField>
        <FormField
          label="AgentMail inbox ID"
          htmlFor="scout-agentmail-inbox"
          hint="Leave blank when it is the email address"
        >
          <Input
            id="scout-agentmail-inbox"
            aria-describedby="scout-agentmail-inbox-hint"
            name="agentMailInboxId"
            value={fields.inboxId}
            autoComplete="off"
            placeholder="Defaults to AgentMail address"
            maxLength={200}
            disabled={submitting}
            onChange={(event) => updateField("inboxId", event.currentTarget.value)}
          />
        </FormField>
        <FormField
          label="Firecrawl profile"
          htmlFor="scout-firecrawl-profile"
          hint="The saved profile name, not a session ID"
          className="sm:col-span-2"
        >
          <Input
            id="scout-firecrawl-profile"
            aria-describedby="scout-firecrawl-profile-hint"
            name="firecrawlProfile"
            value={fields.profileName}
            autoComplete="off"
            placeholder="scout-conrad"
            required
            maxLength={100}
            disabled={submitting}
            onChange={(event) => updateField("profileName", event.currentTarget.value)}
          />
        </FormField>

        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
            {submitting ? "Registering" : "Register scout"}
          </Button>
        </div>
        {state.kind === "failed" ? (
          <p className="text-destructive text-sm sm:col-span-2" role="alert">
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function FormField({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {hint ? (
        <span id={`${htmlFor}-hint`} className="text-muted-foreground ml-2 text-xs">
          {hint}
        </span>
      ) : null}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function slugFromDisplayName(value: string) {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function registrationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const knownMessages = [
    ["Scout slug is already registered", "That scout slug is already registered."],
    [
      "AgentMail address is already registered to another Scout",
      "That AgentMail address belongs to another scout.",
    ],
    [
      "AgentMail inbox is already registered to another Scout",
      "That AgentMail inbox belongs to another scout.",
    ],
    [
      "Firecrawl profile is already registered to another Scout",
      "That Firecrawl profile belongs to another scout.",
    ],
    "AgentMail address must be a valid email address",
    "Scout slug must contain only lowercase letters, numbers, and single hyphens",
  ] as const;
  for (const known of knownMessages) {
    if (typeof known === "string" && message.includes(known)) {
      return known;
    }
    if (typeof known !== "string" && message.includes(known[0])) {
      return known[1];
    }
  }
  return "Could not register the scout. Check the values and try again.";
}

function ScoutStatus({ status }: { status: ScoutStatus }) {
  const label = status === "active" ? "Active" : "Disabled";
  const dotClass = status === "active" ? "bg-emerald-500" : "bg-muted-foreground";

  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-sm">
      <span className={`size-2 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  );
}
