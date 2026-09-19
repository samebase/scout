import { outdent } from "outdent";
import type { Doc } from "../_generated/dataModel";

type RuntimeManagedCredential = {
  credentialHost: string;
  identifier: string;
};

export type RuntimeServiceAccount = {
  serviceAccountId: string;
  serviceName: string;
  serviceDomain: string;
  identifier: string;
  authenticationEvidence: Doc<"scoutServiceAccounts">["authenticationEvidence"];
  loginMethod:
    | { kind: "managed_password"; credentialHost: string; createdAt: number }
    | { kind: "passwordless" }
    | { kind: "oauth"; providerAccountId: string };
};

export function scoutWebsiteIdentityInstructions(
  scout: Pick<Doc<"scouts">, "displayName" | "websiteIdentity" | "agentMail">,
) {
  return outdent`
    Scout identity:

    - First name: ${JSON.stringify(scout.websiteIdentity.firstName)}
    - Last name: ${JSON.stringify(scout.websiteIdentity.lastName)}
    - Display name: ${JSON.stringify(scout.displayName)}
    - Email: ${JSON.stringify(scout.agentMail.address)}
    - Date of birth: 1996-01-01

    This identity and inbox belong to the Scout. Use this identity for the Scout's
    accounts and this inbox for sending and receiving email. When a form asks for age,
    calculate it from this date of birth.
  `;
}

export function managedCredentialInstructions(
  credentials: ReadonlyArray<RuntimeManagedCredential>,
) {
  if (credentials.length === 0) {
    return outdent`
      Managed passwords: none.
    `;
  }
  const available = credentials
    .map(
      (credential) => outdent`
        - ${credential.credentialHost}: ${JSON.stringify(credential.identifier)}
      `,
    )
    .join("\n");
  return outdent`
    Managed passwords available through fill_account_password on these exact hosts:
    ${available}
  `;
}

export function serviceAccountLoginInstructions(accounts: ReadonlyArray<RuntimeServiceAccount>) {
  if (accounts.length === 0) {
    return outdent`
      Registered service accounts: none.
    `;
  }
  const byId = new Map(accounts.map((account) => [account.serviceAccountId, account]));
  const inventory = accounts
    .map((account) => {
      const authentication = {
        none: "signup or login not yet verified",
        succeeded: "authentication verified",
        failed: "last authentication check failed",
      }[account.authenticationEvidence.kind];
      if (account.loginMethod.kind === "managed_password") {
        return outdent`
          - ${account.serviceName} at ${account.serviceDomain}
            as ${JSON.stringify(account.identifier)}: managed password; ${authentication}
        `;
      }
      if (account.loginMethod.kind === "passwordless") {
        return outdent`
          - ${account.serviceName} at ${account.serviceDomain}
            as ${JSON.stringify(account.identifier)}: email code or magic link; ${authentication}
        `;
      }
      const provider = byId.get(account.loginMethod.providerAccountId);
      if (!provider) {
        throw new Error("OAuth login method references a missing Scout service account");
      }
      return outdent`
        - ${account.serviceName} at ${account.serviceDomain}
          as ${JSON.stringify(account.identifier)}:
          OAuth through ${provider.serviceName} at ${provider.serviceDomain}
          as ${JSON.stringify(provider.identifier)}; ${authentication}
      `;
    })
    .join("\n");
  return outdent`
    Registered service accounts:
    ${inventory}
  `;
}
