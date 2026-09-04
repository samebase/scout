"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { env, type ActionCtx } from "../_generated/server";
import { createAccountPasswordFillTool, requirePasswordInputType } from "./accountPasswordTool";
import type { createBrowserHarness } from "./browserTools";
import {
  credentialKeyFingerprint,
  decodeCredentialMasterKey,
  decryptCredential,
} from "./credentialCrypto";
import { createServiceAccountRecordingTool } from "./serviceAccountTool";

export function assertCredentialBrowserUrl(value: string, credentialHost: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("The current browser URL could not be verified for credential entry");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    hostname !== credentialHost
  ) {
    throw new Error("The account password can only be filled on its exact configured login host");
  }
}

type RuntimeManagedCredential = {
  credentialReference: string;
  identifier: string;
  serviceDomain: string;
  credentialHost: string;
  keyFingerprint: string;
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
};

export function decryptRuntimeManagedPassword(
  credential: RuntimeManagedCredential,
  scoutId: string,
  encodedMasterKey: string | undefined,
) {
  const key = decodeCredentialMasterKey(encodedMasterKey);
  try {
    if (credentialKeyFingerprint(key) !== credential.keyFingerprint) {
      throw new Error("Scout credential key does not match configured version");
    }
    return decryptCredential(
      {
        nonce: credential.nonce,
        ciphertext: credential.ciphertext,
        authenticationTag: credential.authenticationTag,
      },
      key,
      {
        credentialReference: credential.credentialReference,
        scoutId,
        serviceDomain: credential.serviceDomain,
        credentialHost: credential.credentialHost,
        identifier: credential.identifier,
        keyFingerprint: credential.keyFingerprint,
      },
    );
  } finally {
    key.fill(0);
  }
}

export function createAccountTools(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    browser: ReturnType<typeof createBrowserHarness>;
    scoutId: Id<"scouts">;
    credentials: ReadonlyArray<RuntimeManagedCredential>;
    sessionId: () => Id<"scoutBrowserSessions"> | null;
  },
) {
  const serviceAccountTools = {
    record_authenticated_service_account: createServiceAccountRecordingTool(
      async ({ accountAccess, identityText, loginMethod, sessionControlText }, abortSignal) => {
        const identity = await args.browser.actions.getElement(
          {
            kind: "text",
            text: identityText,
            exact: true,
          },
          abortSignal,
        );
        const sessionControl = await args.browser.actions.getElement(
          {
            kind: "text",
            text: sessionControlText,
            exact: true,
          },
          abortSignal,
        );
        const currentUrl = await args.browser.actions.getPage("url", abortSignal);
        if (!identity.success || !sessionControl.success || !currentUrl.success) {
          throw new Error(
            "The authenticated account evidence could not be read from the current page",
          );
        }
        const browserSessionId = args.sessionId();
        if (!browserSessionId) throw new Error("Browser session was not registered");
        return await ctx.runMutation(internal.scout.serviceAccounts.recordAuthenticated, {
          sessionId: browserSessionId,
          accountAccess,
          loginMethod,
          observedUrl: currentUrl.output,
          visibleIdentity: identity.output,
          visibleSessionControl: sessionControl.output,
        });
      },
    ),
  };
  const accountPasswordTools =
    args.credentials.length > 0
      ? {
          fill_account_password: createAccountPasswordFillTool(
            async ({ passwordTarget, passwordConfirmationTarget }, toolCallId, abortSignal) => {
              const currentUrl = await args.browser.actions.getPage("url", abortSignal);
              if (!currentUrl.success) {
                throw new Error("The current browser URL could not be verified");
              }
              let currentHostname: string;
              try {
                currentHostname = new URL(currentUrl.output).hostname.toLowerCase();
              } catch {
                throw new Error("The current browser URL could not be verified");
              }
              const runtimeCredential = args.credentials.find(
                (credential) => credential.credentialHost === currentHostname,
              );
              if (!runtimeCredential) {
                throw new Error("This Scout has no managed password for the current login host");
              }
              assertCredentialBrowserUrl(currentUrl.output, runtimeCredential.credentialHost);
              const passwordField = await args.browser.actions.getElementAttribute(
                passwordTarget,
                "type",
                abortSignal,
              );
              if (!passwordField.success) {
                throw new Error("The configured password field could not be verified");
              }
              requirePasswordInputType(passwordField.output);
              if (passwordConfirmationTarget) {
                const confirmationField = await args.browser.actions.getElementAttribute(
                  passwordConfirmationTarget,
                  "type",
                  abortSignal,
                );
                if (!confirmationField.success) {
                  throw new Error(
                    "The configured password confirmation field could not be verified",
                  );
                }
                requirePasswordInputType(confirmationField.output);
              }
              let password: string;
              try {
                password = decryptRuntimeManagedPassword(
                  runtimeCredential,
                  args.scoutId,
                  env.SCOUT_CREDENTIAL_MASTER_KEY_V1,
                );
              } catch {
                throw new Error("Managed password fill is unavailable");
              }
              args.browser.actions.registerSensitiveValue(password);
              const passwordResult = await args.browser.actions.fillManagedPassword(
                {
                  passwordTarget,
                  ...(passwordConfirmationTarget ? { passwordConfirmationTarget } : {}),
                },
                password,
                toolCallId,
                abortSignal,
              );
              if (!passwordResult.success) {
                throw new Error("The configured account password could not be filled");
              }
              return { filledFields: passwordConfirmationTarget ? 2 : 1 };
            },
          ),
        }
      : {};

  return { ...accountPasswordTools, ...serviceAccountTools };
}
