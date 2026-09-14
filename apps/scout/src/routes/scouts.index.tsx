import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { ServiceIcon } from "#components/service-icon";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { canAccess, useViewerAccess } from "#lib/access";

const searchSchema = z.object({ view: z.literal("register").optional().catch(undefined) });

export const Route = createFileRoute("/scouts/")({
  staticData: { access: "access_scout_view" },
  validateSearch: (search) => searchSchema.parse(search),
  component: ScoutsIndexPage,
});

type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];
type ServiceAccount = FunctionReturnType<typeof api.scout.serviceAccounts.list>[number];
type ServiceSummary = Pick<ServiceAccount, "serviceName" | "serviceDomain">;
type ScoutStatus = Scout["status"];

type RegistrationFields = {
  firstName: string;
  lastName: string;
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
  firstName: "",
  lastName: "",
  slug: "",
  address: "",
  inboxId: "",
  profileName: "",
};

function ScoutsIndexPage() {
  const viewer = useViewerAccess();
  const canManage =
    viewer?.kind === "account" && canAccess("access_scout_manage", viewer.accessKeys);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/scouts/" });
  const scouts = useQuery(api.scout.scouts.list);
  const serviceAccounts = useQuery(api.scout.serviceAccounts.list, canManage ? {} : "skip");
  const registrationOpen = canManage && search.view === "register";
  const [registrationSubmitting, setRegistrationSubmitting] = useState(false);
  const registrationButton = useRef<HTMLButtonElement>(null);
  const servicesByScout =
    serviceAccounts === undefined ? undefined : groupServicesByScout(serviceAccounts);

  const closeRegistration = () => {
    if (registrationSubmitting) {
      return;
    }
    void navigate({ search: {} });
    requestAnimationFrame(() => registrationButton.current?.focus());
  };

  return (
    <>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div>
          <h1 className="route-heading">Scouts</h1>
        </div>
        <div className="flex items-center gap-3 sm:pb-1">
          <p className="sr-only" aria-live="polite">
            {scouts === undefined ? "Loading scouts..." : `Showing ${scouts.length}`}
          </p>
          {canManage && (
            <Button
              ref={registrationButton}
              type="button"
              size="sm"
              aria-expanded={registrationOpen}
              aria-controls="register-scout-panel"
              disabled={registrationSubmitting}
              onClick={() => {
                void navigate({ search: { view: registrationOpen ? undefined : "register" } });
              }}
            >
              {registrationOpen ? <XIcon /> : <PlusIcon />}
              {registrationOpen ? "Close" : "Register scout"}
            </Button>
          )}
        </div>
      </header>

      {registrationOpen ? (
        <ScoutRegistrationForm
          onCancel={closeRegistration}
          onSubmittingChange={setRegistrationSubmitting}
        />
      ) : null}

      {scouts === undefined ? (
        <p className="surface-panel py-16 text-center text-sm text-muted-foreground" role="status">
          Loading scouts...
        </p>
      ) : scouts.length === 0 ? (
        <div className="surface-panel border-dashed px-5 py-16 text-center">
          <p className="text-base font-semibold">No Scouts yet</p>
          {canManage && (
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Register an AgentMail inbox and Firecrawl profile to give workers a reusable identity.
            </p>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Scouts">
          {scouts.map((scout) => {
            const services = servicesByScout?.get(scout._id) ?? [];

            return (
              <li key={scout._id} className="surface-panel overflow-hidden">
                <Link
                  to="/scouts/$slug"
                  params={{ slug: scout.slug }}
                  className="group block h-full p-5 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40 sm:p-6"
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
                      <dt className="text-muted-foreground text-xs">Email</dt>
                      <dd className="mt-1 wrap-break-word">{scout.agentMail.address}</dd>
                    </div>
                    {services.length > 0 ? (
                      <div className="min-w-0 sm:col-span-2">
                        <dt className="text-muted-foreground text-xs">Accounts</dt>
                        <dd className="mt-2 flex flex-wrap gap-2">
                          {services.map((service) => (
                            <span
                              key={service.serviceDomain}
                              className="bg-background inline-flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5"
                            >
                              <ServiceIcon
                                serviceName={service.serviceName}
                                serviceDomain={service.serviceDomain}
                              />
                              <span className="min-w-0 leading-tight">
                                <span className="block wrap-break-word text-xs font-medium">
                                  {service.serviceName}
                                </span>
                                <span className="text-muted-foreground block wrap-break-word font-mono text-[0.625rem]">
                                  {service.serviceDomain}
                                </span>
                              </span>
                            </span>
                          ))}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function groupServicesByScout(accounts: readonly ServiceAccount[]) {
  const servicesByScout = new Map<Scout["_id"], Map<string, ServiceSummary>>();

  for (const account of accounts) {
    let services = servicesByScout.get(account.scoutId);
    if (services === undefined) {
      services = new Map<string, ServiceSummary>();
      servicesByScout.set(account.scoutId, services);
    }
    if (!services.has(account.serviceDomain)) {
      services.set(account.serviceDomain, {
        serviceName: account.serviceName,
        serviceDomain: account.serviceDomain,
      });
    }
  }

  return new Map(
    Array.from(servicesByScout, ([scoutId, services]) => [scoutId, Array.from(services.values())]),
  );
}

function ScoutRegistrationForm({
  onCancel,
  onSubmittingChange,
}: {
  onCancel: () => void;
  onSubmittingChange: (submitting: boolean) => void;
}) {
  const registerScout = useAction(api.scout.scoutRegistration.register);
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

  const onFirstNameChange = (firstName: string) => {
    setFields((current) => ({
      ...current,
      firstName,
      ...(slugEdited ? {} : { slug: slugFromName(firstName) }),
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

    const firstName = fields.firstName.trim();
    const lastName = fields.lastName.trim();
    const displayName = `${firstName} ${lastName}`;
    if (!firstName || !lastName) {
      setState({ kind: "failed", message: "Enter both a first and last name." });
      return;
    }
    if (displayName.length > 100) {
      setState({
        kind: "failed",
        message: "First and last name together must be 100 characters or fewer.",
      });
      return;
    }

    const slug = fields.slug.trim().toLowerCase();
    const address = fields.address.trim().toLowerCase();
    setState({ kind: "submitting" });
    onSubmittingChange(true);
    try {
      await registerScout({
        displayName,
        slug,
        websiteIdentity: { firstName, lastName },
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
      className="surface-panel p-5 sm:p-6"
      aria-labelledby="register-scout-heading"
    >
      <div>
        <h2 id="register-scout-heading" className="text-xl font-semibold tracking-[-0.025em]">
          Register scout
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect one existing AgentMail inbox to one persistent Firecrawl profile.
        </p>
      </div>

      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <FormField label="First name" htmlFor="scout-first-name">
          <Input
            id="scout-first-name"
            name="firstName"
            value={fields.firstName}
            autoComplete="off"
            placeholder="Conrad"
            autoFocus
            required
            maxLength={100}
            disabled={submitting}
            onChange={(event) => onFirstNameChange(event.currentTarget.value)}
          />
        </FormField>
        <FormField label="Last name" htmlFor="scout-last-name">
          <Input
            id="scout-last-name"
            name="lastName"
            value={fields.lastName}
            autoComplete="off"
            placeholder="Scout"
            required
            maxLength={100}
            disabled={submitting}
            onChange={(event) => updateField("lastName", event.currentTarget.value)}
          />
        </FormField>
        <FormField label="Slug" htmlFor="scout-slug" hint="Suggested from the first name">
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
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
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

function slugFromName(value: string) {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function registrationError(error: unknown) {
  if (error instanceof ConvexError) {
    const message = z.string().safeParse(error.data);
    if (message.success) return message.data;
  }
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
      "Configured AgentMail inbox ID and address do not identify the same inbox",
      "That AgentMail inbox ID does not match the address.",
    ],
    ["AgentMail inbox lookup failed", "AgentMail could not verify that inbox."],
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
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
      <span className={`size-2 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  );
}
