import { Link, createFileRoute } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftIcon, LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { ServiceIcon } from "#components/service-icon";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";

export const Route = createFileRoute("/scouts/$slug")({
  component: ScoutDetailPage,
});

type Scout = NonNullable<FunctionReturnType<typeof api.scout.scouts.get>>;
type ServiceAccount = FunctionReturnType<typeof api.scout.serviceAccounts.list>[number];
type AuthenticationEvidence = ServiceAccount["authenticationEvidence"];

type AccountFields = {
  serviceName: string;
  serviceDomain: string;
  credentialHost: string;
  identifier: string;
};

type RegistrationState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string };

const evidenceDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function ScoutDetailPage() {
  const { slug } = Route.useParams();
  const scout = useQuery(api.scout.scouts.get, { slug });
  const serviceAccounts = useQuery(
    api.scout.serviceAccounts.list,
    scout === undefined || scout === null ? "skip" : { scoutId: scout._id },
  );

  if (scout === undefined) {
    return (
      <section aria-busy="true" aria-live="polite">
        <p className="text-muted-foreground py-10 text-sm">Loading scout...</p>
      </section>
    );
  }

  if (scout === null) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="scout-not-found-heading">
        <Link
          to="/scouts"
          className="text-muted-foreground inline-flex w-fit items-center gap-1.5 text-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back to Scouts
        </Link>
        <div className="rounded-xl border px-4 py-8">
          <h1 id="scout-not-found-heading" className="text-xl font-medium tracking-tight">
            Scout not found
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            No scout matches the slug <code className="font-mono">{slug}</code>.
          </p>
        </div>
      </section>
    );
  }

  const statusLabel = scout.status === "active" ? "Active" : "Disabled";
  const statusDotClass = scout.status === "active" ? "bg-emerald-500" : "bg-muted-foreground";

  return (
    <>
      <header className="flex flex-col gap-5">
        <Link
          to="/scouts"
          className="text-muted-foreground inline-flex w-fit items-center gap-1.5 text-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back to Scouts
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div>
            <h1 className="route-heading wrap-break-word">{scout.displayName}</h1>
            <p className="text-muted-foreground mt-1 font-mono text-xs">/{scout.slug}</p>
            <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-6">
              Worker models act as {scout.displayName} using this identity and the resources below.
            </p>
          </div>
          <span className="inline-flex shrink-0 self-start items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
            <span className={`size-2 rounded-full ${statusDotClass}`} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
      </header>

      <section aria-labelledby="scout-identity-heading">
        <h2 id="scout-identity-heading" className="text-lg font-semibold tracking-[-0.02em]">
          Identity
        </h2>
        <dl className="surface-panel mt-3 grid gap-5 p-5 text-sm sm:grid-cols-2 sm:p-6">
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">First name</dt>
            <dd className="mt-1 wrap-break-word">
              {scout.websiteIdentity?.firstName ?? "Not configured"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">Last name</dt>
            <dd className="mt-1 wrap-break-word">
              {scout.websiteIdentity?.lastName ?? "Not configured"}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="scout-provider-connections-heading">
        <h2
          id="scout-provider-connections-heading"
          className="text-lg font-semibold tracking-[-0.02em]"
        >
          Runtime resources
        </h2>
        <dl className="surface-panel mt-3 grid gap-5 p-5 text-sm sm:grid-cols-2 sm:p-6">
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">AgentMail inbox</dt>
            <dd className="mt-1 wrap-break-word font-mono text-xs">{scout.agentMail.inboxId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">AgentMail address</dt>
            <dd className="mt-1 wrap-break-word">{scout.agentMail.address}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-muted-foreground text-xs">Firecrawl profile</dt>
            <dd className="mt-1 wrap-break-word">{scout.firecrawl.profileName}</dd>
          </div>
        </dl>
      </section>

      <ServiceAccountsSection scout={scout} accounts={serviceAccounts} />
    </>
  );
}

function ServiceAccountsSection({
  scout,
  accounts,
}: {
  scout: Scout;
  accounts: ServiceAccount[] | undefined;
}) {
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

  const finishRegistration = () => {
    setRegistrationSubmitting(false);
    setRegistrationOpen(false);
    requestAnimationFrame(() => registrationButton.current?.focus());
  };

  return (
    <section aria-labelledby="scout-service-accounts-heading">
      <div className="flex items-center justify-between gap-4">
        <h2
          id="scout-service-accounts-heading"
          className="text-lg font-semibold tracking-[-0.02em]"
        >
          Service accounts
        </h2>
        <Button
          ref={registrationButton}
          type="button"
          size="sm"
          variant={registrationOpen ? "outline" : "default"}
          aria-expanded={registrationOpen}
          aria-controls="register-service-account-panel"
          disabled={registrationSubmitting}
          onClick={() => setRegistrationOpen((open) => !open)}
        >
          {registrationOpen ? <XIcon /> : <PlusIcon />}
          {registrationOpen ? "Close" : "Add account"}
        </Button>
      </div>

      {registrationOpen ? (
        <AccountRegistrationForm
          scout={scout}
          onRegistered={finishRegistration}
          onCancel={closeRegistration}
          onSubmittingChange={setRegistrationSubmitting}
        />
      ) : null}

      {accounts === undefined ? (
        <p className="surface-panel mt-3 px-5 py-10 text-sm text-muted-foreground" role="status">
          Loading service accounts...
        </p>
      ) : accounts.length === 0 ? (
        <p className="surface-panel mt-3 border-dashed px-5 py-10 text-sm text-muted-foreground">
          No service accounts registered.
        </p>
      ) : (
        <ul className="surface-panel mt-3 divide-y overflow-hidden" aria-label="Service accounts">
          {accounts.map((account) => (
            <li key={account._id} className="grid gap-4 p-4 text-sm sm:grid-cols-2 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <ServiceIcon
                  serviceName={account.serviceName}
                  serviceDomain={account.serviceDomain}
                  className="size-8 rounded-lg"
                />
                <div className="min-w-0">
                  <p className="wrap-break-word font-medium">{account.serviceName}</p>
                  <p className="text-muted-foreground mt-1 wrap-break-word text-xs">
                    {account.serviceDomain}
                  </p>
                </div>
              </div>
              <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Identifier</dt>
                  <dd className="mt-1 wrap-break-word">{account.identifier}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Authentication</dt>
                  <dd className="mt-1">
                    <AuthenticationEvidence evidence={account.authenticationEvidence} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Password</dt>
                  <dd className="mt-1">
                    {account.managedCredential ? (
                      <span>
                        Managed · Prepared{" "}
                        <EvidenceTime timestamp={account.managedCredential.createdAt} />
                      </span>
                    ) : (
                      <span className="text-muted-foreground">External</span>
                    )}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AccountRegistrationForm({
  scout,
  onRegistered,
  onCancel,
  onSubmittingChange,
}: {
  scout: Scout;
  onRegistered: () => void;
  onCancel: () => void;
  onSubmittingChange: (submitting: boolean) => void;
}) {
  const registerAccount = useAction(api.scout.serviceAccountCredentialActions.registerManaged);
  const [fields, setFields] = useState<AccountFields>({
    serviceName: "",
    serviceDomain: "",
    credentialHost: "",
    identifier: scout.agentMail.address,
  });
  const [state, setState] = useState<RegistrationState>({ kind: "idle" });
  const submitting = state.kind === "submitting";

  const updateField = <Key extends keyof AccountFields>(key: Key, value: AccountFields[Key]) => {
    setFields((current) => ({ ...current, [key]: value }));
    if (state.kind === "failed") {
      setState({ kind: "idle" });
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const serviceName = fields.serviceName.trim();
    const serviceDomain = fields.serviceDomain.trim().toLowerCase();
    const credentialHost = fields.credentialHost.trim().toLowerCase();
    const identifier = fields.identifier.trim();
    if (!serviceName || !serviceDomain || !credentialHost || !identifier) {
      setState({
        kind: "failed",
        message: "Enter a service, product domain, login host, and account identifier.",
      });
      return;
    }
    if (
      serviceDomain.includes("://") ||
      serviceDomain.includes("/") ||
      serviceDomain.includes(":") ||
      serviceDomain.includes("@") ||
      credentialHost.includes("://") ||
      credentialHost.includes("/") ||
      credentialHost.includes(":") ||
      credentialHost.includes("@")
    ) {
      setState({
        kind: "failed",
        message: "Enter only the exact login host, such as account.example.com.",
      });
      return;
    }

    setState({ kind: "submitting" });
    onSubmittingChange(true);
    try {
      await registerAccount({
        scoutId: scout._id,
        serviceName,
        serviceDomain,
        credentialHost,
        identifier,
      });
      setFields({
        serviceName: "",
        serviceDomain: "",
        credentialHost: "",
        identifier: scout.agentMail.address,
      });
      setState({ kind: "idle" });
      onRegistered();
    } catch (error) {
      onSubmittingChange(false);
      setState({ kind: "failed", message: accountRegistrationError(error) });
    }
  };

  return (
    <div id="register-service-account-panel" className="surface-panel mt-4 p-5 sm:p-6">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <p className="text-muted-foreground text-sm sm:col-span-2">
          Scout generates and encrypts the password. It can fill the password during a run, but it
          cannot display it here.
        </p>
        <FormField label="Service name" htmlFor="service-account-name">
          <Input
            id="service-account-name"
            name="serviceName"
            value={fields.serviceName}
            autoComplete="off"
            placeholder="Tally"
            autoFocus
            required
            maxLength={100}
            disabled={submitting}
            onChange={(event) => updateField("serviceName", event.currentTarget.value)}
          />
        </FormField>
        <FormField label="Product domain" htmlFor="service-account-domain">
          <Input
            id="service-account-domain"
            name="serviceDomain"
            value={fields.serviceDomain}
            autoComplete="off"
            inputMode="url"
            placeholder="example.com"
            required
            maxLength={253}
            disabled={submitting}
            onChange={(event) => updateField("serviceDomain", event.currentTarget.value)}
          />
        </FormField>
        <FormField label="Exact login host" htmlFor="service-account-login-host">
          <Input
            id="service-account-login-host"
            name="credentialHost"
            value={fields.credentialHost}
            autoComplete="off"
            inputMode="url"
            placeholder="account.example.com"
            required
            maxLength={253}
            disabled={submitting}
            onChange={(event) => updateField("credentialHost", event.currentTarget.value)}
          />
        </FormField>
        <FormField label="Account identifier" htmlFor="service-account-identifier">
          <Input
            id="service-account-identifier"
            name="identifier"
            value={fields.identifier}
            autoComplete="off"
            placeholder="Email address or username"
            required
            maxLength={320}
            disabled={submitting}
            onChange={(event) => updateField("identifier", event.currentTarget.value)}
          />
        </FormField>

        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
            {submitting ? "Adding" : "Add account"}
          </Button>
        </div>
        {state.kind === "failed" ? (
          <p className="text-destructive text-sm sm:col-span-2" role="alert">
            {state.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}

function AuthenticationEvidence({ evidence }: { evidence: AuthenticationEvidence }) {
  switch (evidence.kind) {
    case "none":
      return <span className="text-muted-foreground">Not checked</span>;
    case "succeeded":
      return (
        <span>
          Succeeded <EvidenceTime timestamp={evidence.checkedAt} />
        </span>
      );
    case "failed":
      return (
        <span>
          Failed <EvidenceTime timestamp={evidence.checkedAt} />
          {evidence.lastSucceededAt === undefined ? null : (
            <span className="text-muted-foreground block text-xs">
              Last succeeded <EvidenceTime timestamp={evidence.lastSucceededAt} />
            </span>
          )}
        </span>
      );
    default: {
      const exhaustive: never = evidence;
      return exhaustive;
    }
  }
}

function EvidenceTime({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp);
  return <time dateTime={date.toISOString()}>{evidenceDate.format(date)}</time>;
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function accountRegistrationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Service account is already registered")) {
    return "That account is already registered for this scout.";
  }
  if (message.includes("already has a managed credential")) {
    return "This scout already has a managed password for that product.";
  }
  if (message.includes("SCOUT_CREDENTIAL_MASTER_KEY_V1")) {
    return "Managed credential encryption is not configured for this deployment.";
  }
  if (message.includes("Login host")) {
    return "Enter an exact HTTPS login host without a path, such as account.example.com.";
  }
  if (message.includes("service domain") || message.includes("Service domain")) {
    return "Enter a valid product domain, such as example.com.";
  }
  return "Could not add the account. Check the values and try again.";
}
