import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { ServiceIcon } from "./service-icon";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Scout = NonNullable<FunctionReturnType<typeof api.scout.scouts.get>>;
type ListedAccount = FunctionReturnType<typeof api.scout.serviceAccounts.list>[number];
type ServiceAccount = Extract<ListedAccount, { kind: "details" }>;
type AuthenticationEvidence = ServiceAccount["authenticationEvidence"];
type PasswordArgs = FunctionArgs<typeof api.scout.serviceAccountCredentialActions.savePassword>;
export type AccountEditor =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "update"; account: ServiceAccount };
type SaveState = { kind: "idle" } | { kind: "submitting" } | { kind: "failed"; message: string };
type Login =
  | { kind: "password"; password: PasswordArgs["password"]; credentialHost: string }
  | { kind: "passwordless" }
  | { kind: "oauth"; providerAccountId: ServiceAccount["_id"] | null };

const evidenceDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const selectClassName =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

export function ServiceAccountsSection({
  scout,
  accounts,
  management,
}: {
  scout: Scout;
  accounts: ListedAccount[] | undefined;
  management: {
    editor: AccountEditor;
    onEdit: (editor: AccountEditor) => void;
  } | null;
}) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const detailedAccounts = accounts?.filter((account) => account.kind === "details") ?? [];

  const close = () => {
    management?.onEdit({ kind: "closed" });
    requestAnimationFrame(() => trigger.current?.focus());
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
        {management && (
          <Button
            type="button"
            size="sm"
            disabled={
              scout.status !== "active" ||
              accounts === undefined ||
              management.editor.kind !== "closed"
            }
            onClick={(event) => {
              trigger.current = event.currentTarget;
              management.onEdit({ kind: "create" });
            }}
          >
            <PlusIcon /> Add account
          </Button>
        )}
      </div>

      {management && scout.agentMail && management.editor.kind !== "closed" && (
        <AccountForm
          key={management.editor.kind === "update" ? management.editor.account._id : "create"}
          scoutId={scout._id}
          defaultIdentifier={scout.agentMail.address}
          accounts={detailedAccounts}
          account={management.editor.kind === "update" ? management.editor.account : null}
          onSaved={close}
          onCancel={close}
        />
      )}

      {accounts === undefined ? (
        <div className="surface-panel mt-3 min-h-28" aria-busy="true" />
      ) : accounts.length === 0 ? (
        <p className="surface-panel mt-3 border-dashed px-5 py-10 text-sm text-muted-foreground">
          No service accounts registered.
        </p>
      ) : (
        <ul className="surface-panel mt-3 divide-y overflow-hidden" aria-label="Service accounts">
          {accounts.map((account) => (
            <li key={account._id} className="grid gap-4 p-4 text-sm sm:p-5">
              <div className="flex items-start justify-between gap-3">
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
                {management && account.kind === "details" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Edit ${account.serviceName} login`}
                    disabled={scout.status !== "active" || management.editor.kind !== "closed"}
                    onClick={(event) => {
                      trigger.current = event.currentTarget;
                      management.onEdit({ kind: "update", account });
                    }}
                  >
                    Edit login
                  </Button>
                )}
              </div>
              {account.kind === "details" && (
                <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Email or username</dt>
                    <dd className="mt-1 wrap-break-word">{account.identifier}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Authentication</dt>
                    <dd className="mt-1">
                      <AuthenticationEvidence evidence={account.authenticationEvidence} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Login</dt>
                    <dd className="mt-1">
                      <LoginMethod account={account} accounts={detailedAccounts} />
                    </dd>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LoginMethod({
  account,
  accounts,
}: {
  account: ServiceAccount;
  accounts: ServiceAccount[];
}) {
  const loginMethod = account.loginMethod;
  switch (loginMethod.kind) {
    case "passwordless":
      return <span>Email code or link</span>;
    case "managed_password":
      return (
        <span>
          Password · <EvidenceTime timestamp={loginMethod.createdAt} />
        </span>
      );
    case "oauth": {
      const provider = accounts.find(
        (candidate) => candidate._id === loginMethod.providerAccountId,
      );
      return provider ? (
        <span>
          Sign in with {provider.serviceName} · {provider.identifier}
        </span>
      ) : (
        <span className="text-destructive">Provider account missing</span>
      );
    }
    default: {
      const exhaustive: never = loginMethod;
      return exhaustive;
    }
  }
}

function AccountForm({
  scoutId,
  defaultIdentifier,
  accounts,
  account,
  onSaved,
  onCancel,
}: {
  scoutId: Scout["_id"];
  defaultIdentifier: string;
  accounts: ServiceAccount[];
  account: ServiceAccount | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const savePassword = useAction(api.scout.serviceAccountCredentialActions.savePassword);
  const saveOAuth = useMutation(api.scout.serviceAccounts.saveOAuth);
  const savePasswordless = useMutation(api.scout.serviceAccounts.savePasswordless);
  const [serviceName, setServiceName] = useState(account?.serviceName ?? "");
  const [serviceDomain, setServiceDomain] = useState(account?.serviceDomain ?? "");
  const [identifier, setIdentifier] = useState(account?.identifier ?? defaultIdentifier);
  const [login, setLogin] = useState<Login>(() => {
    const loginMethod = account?.loginMethod;
    switch (loginMethod?.kind) {
      case "oauth":
        return { kind: "oauth", providerAccountId: loginMethod.providerAccountId };
      case "passwordless":
        return { kind: "passwordless" };
      case "managed_password":
      case undefined:
        return {
          kind: "password",
          password: { kind: "provided", value: "" },
          credentialHost: loginMethod?.credentialHost ?? "",
        };
      default: {
        const exhaustive: never = loginMethod;
        return exhaustive;
      }
    }
  });
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submitting = state.kind === "submitting";
  const providers = accounts.filter((candidate) => candidate._id !== account?._id);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || (login.kind === "oauth" && !login.providerAccountId)) return;
    const target: PasswordArgs["account"] = account
      ? { kind: "update", serviceAccountId: account._id, identifier }
      : { kind: "create", scoutId, serviceName, serviceDomain, identifier };
    setState({ kind: "submitting" });
    try {
      switch (login.kind) {
        case "passwordless":
          await savePasswordless({ account: target });
          break;
        case "password":
          await savePassword({
            account: target,
            credentialHost: login.credentialHost.trim() || serviceDomain,
            password: login.password,
          });
          break;
        case "oauth":
          if (login.providerAccountId === null) return;
          await saveOAuth({ account: target, providerAccountId: login.providerAccountId });
          break;
        default: {
          const exhaustive: never = login;
          return exhaustive;
        }
      }
      if (mounted.current) onSaved();
    } catch (error) {
      if (mounted.current) setState({ kind: "failed", message: accountSaveError(error) });
    }
  };

  return (
    <div className="surface-panel mt-4 p-5 sm:p-6">
      <h3 className="mb-4 font-medium">
        {account ? `Edit ${account.serviceName} login` : "Add account"}
      </h3>
      <form
        aria-label={account ? "Edit account" : "Add account"}
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => void submit(event)}
      >
        {account ? null : (
          <>
            <FormField label="Service name" htmlFor="service-account-name">
              <Input
                id="service-account-name"
                value={serviceName}
                autoComplete="off"
                placeholder="GitHub"
                autoFocus
                required
                maxLength={100}
                disabled={submitting}
                onChange={(event) => setServiceName(event.currentTarget.value)}
              />
            </FormField>
            <FormField label="Service domain" htmlFor="service-account-domain">
              <Input
                id="service-account-domain"
                value={serviceDomain}
                autoComplete="off"
                inputMode="url"
                placeholder="github.com"
                required
                maxLength={253}
                disabled={submitting}
                onChange={(event) => setServiceDomain(event.currentTarget.value)}
              />
            </FormField>
          </>
        )}
        <div className="sm:col-span-2">
          <FormField label="Email or username" htmlFor="service-account-identifier">
            <Input
              id="service-account-identifier"
              value={identifier}
              autoComplete="off"
              autoFocus={account !== null}
              required
              maxLength={320}
              disabled={submitting}
              onChange={(event) => setIdentifier(event.currentTarget.value)}
            />
          </FormField>
        </div>
        <fieldset disabled={submitting} className="sm:col-span-2">
          <legend className="text-sm font-medium">Login method</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="login-method"
                checked={login.kind === "password"}
                onChange={() =>
                  setLogin({
                    kind: "password",
                    password: { kind: "provided", value: "" },
                    credentialHost:
                      account?.loginMethod.kind === "managed_password"
                        ? account.loginMethod.credentialHost
                        : "",
                  })
                }
              />
              Password
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="login-method"
                checked={login.kind === "passwordless"}
                onChange={() => setLogin({ kind: "passwordless" })}
              />
              Email code or link
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="login-method"
                checked={login.kind === "oauth"}
                onChange={() => setLogin({ kind: "oauth", providerAccountId: null })}
              />
              Sign in with another account
            </label>
          </div>
        </fieldset>
        {login.kind === "password" ? (
          <>
            <FormField label="Password source" htmlFor="service-account-password-source">
              <select
                id="service-account-password-source"
                className={selectClassName}
                disabled={submitting}
                value={login.password.kind}
                onChange={(event) =>
                  setLogin({
                    ...login,
                    password:
                      event.currentTarget.value === "generate"
                        ? { kind: "generate" }
                        : { kind: "provided", value: "" },
                  })
                }
              >
                <option value="provided">Enter a password</option>
                <option value="generate">Generate for Scout</option>
              </select>
            </FormField>
            <FormField label="Login host" htmlFor="service-account-login-host">
              <Input
                id="service-account-login-host"
                value={login.credentialHost}
                autoComplete="off"
                inputMode="url"
                placeholder={serviceDomain || "github.com"}
                maxLength={253}
                disabled={submitting}
                onChange={(event) =>
                  setLogin({ ...login, credentialHost: event.currentTarget.value })
                }
              />
            </FormField>
            <div className="sm:col-span-2">
              {login.password.kind === "provided" ? (
                <>
                  <FormField
                    label={account ? "New password" : "Password"}
                    htmlFor="service-account-password"
                  >
                    <Input
                      id="service-account-password"
                      type="password"
                      autoComplete="new-password"
                      value={login.password.value}
                      required
                      maxLength={1024}
                      disabled={submitting}
                      aria-describedby="service-account-password-help"
                      onChange={(event) =>
                        setLogin({
                          ...login,
                          password: { kind: "provided", value: event.currentTarget.value },
                        })
                      }
                    />
                  </FormField>
                  <p
                    id="service-account-password-help"
                    className="mt-2 text-xs text-muted-foreground"
                  >
                    Use the same password you set on the website. Scout stores it encrypted.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Scout will fill the generated password on the website. You cannot view it here.
                </p>
              )}
            </div>
          </>
        ) : login.kind === "oauth" ? (
          <div className="sm:col-span-2">
            <FormField label="Provider account" htmlFor="service-account-provider">
              <select
                id="service-account-provider"
                className={selectClassName}
                required
                disabled={submitting || providers.length === 0}
                value={login.providerAccountId ?? ""}
                onChange={(event) =>
                  setLogin({
                    kind: "oauth",
                    providerAccountId:
                      providers.find((provider) => provider._id === event.currentTarget.value)
                        ?._id ?? null,
                  })
                }
              >
                <option value="">Choose an account</option>
                {providers.map((provider) => (
                  <option key={provider._id} value={provider._id}>
                    {provider.serviceName} · {provider.identifier}
                  </option>
                ))}
              </select>
            </FormField>
            {providers.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Add the provider account to this Scout first.
              </p>
            ) : null}
          </div>
        ) : null}
        {state.kind === "failed" ? (
          <p className="text-destructive text-sm sm:col-span-2" role="alert">
            {state.message}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || (login.kind === "oauth" && login.providerAccountId === null)}
          >
            {submitting ? <LoaderCircleIcon className="animate-spin" /> : null}
            {submitting ? "Saving" : "Save account"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function accountSaveError(error: unknown) {
  if (error instanceof ConvexError) {
    const message = z.string().safeParse(error.data);
    if (message.success) return message.data;
  }
  return "Could not save the account. Try again.";
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
