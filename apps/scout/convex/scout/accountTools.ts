"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getRuntimeEnv } from "../runtimeEnv";
import {
  createAccountPasswordFillTool,
  createAccountPasswordPreparationTool,
  requirePasswordInputType,
} from "./accountPasswordTool";
import type { createBrowserHarness } from "./browserTools";
import {
  credentialKeyFingerprint,
  decodeCredentialMasterKey,
  decryptCredential,
} from "./credentialCrypto";
import { createServiceAccountRecordingTool } from "./serviceAccountTool";
import { prepareManagedPassword } from "./serviceAccountCredentialActions";

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

export function restoreManagedPasswordRedaction({
  browser,
  credentials,
  scoutId,
}: {
  browser: ReturnType<typeof createBrowserHarness>;
  credentials: ReadonlyArray<RuntimeManagedCredential>;
  scoutId: Id<"scouts">;
}) {
  for (const credential of credentials) {
    browser.actions.registerSensitiveValue(
      decryptRuntimeManagedPassword(
        credential,
        scoutId,
        getRuntimeEnv("SCOUT_CREDENTIAL_MASTER_KEY_V1"),
      ),
    );
  }
}

export function createAccountTools(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  args: {
    browser: ReturnType<typeof createBrowserHarness>;
    scoutId: Id<"scouts">;
    sessionId: () => Id<"scoutBrowserSessions"> | null;
  },
) {
  const serviceAccountTools = {
    prepare_account_password: createAccountPasswordPreparationTool(async (account, abortSignal) => {
      const currentUrl = await args.browser.actions.getPage("url", abortSignal);
      if (!currentUrl.success) {
        throw new Error("The current signup page could not be verified");
      }
      const sessionId = args.sessionId();
      if (!sessionId) throw new Error("Browser session was not registered");
      abortSignal?.throwIfAborted();
      const result = await prepareManagedPassword(ctx, {
        kind: "browser",
        sessionId,
        observedUrl: currentUrl.output,
        ...account,
      });
      return {
        serviceAccountId: result.serviceAccountId,
        credentialHost: result.loginMethod.credentialHost,
      };
    }),
    record_authenticated_service_account: createServiceAccountRecordingTool(
      async ({ accountAccess, identifier, loginMethod, verification }, abortSignal) => {
        const observationStartedAt = Date.now();
        const currentUrl = await args.browser.actions.getPage("url", abortSignal);
        if (!currentUrl.success) {
          throw new Error("The current service URL could not be read");
        }
        const browserSessionId = args.sessionId();
        if (!browserSessionId) throw new Error("Browser session was not registered");
        return await ctx.runMutation(internal.scout.serviceAccounts.recordAuthenticated, {
          observationStartedAt,
          sessionId: browserSessionId,
          accountAccess,
          loginMethod,
          verification,
          observedUrl: currentUrl.output,
          identifier,
        });
      },
    ),
  };
  const accountPasswordTools = {
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
        const credentials = await ctx.runQuery(
          internal.scout.serviceAccountCredentials.listRuntimeCredentialsForScout,
          { scoutId: args.scoutId },
        );
        const runtimeCredential = credentials.find(
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
            throw new Error("The configured password confirmation field could not be verified");
          }
          requirePasswordInputType(confirmationField.output);
        }
        let password: string;
        try {
          password = decryptRuntimeManagedPassword(
            runtimeCredential,
            args.scoutId,
            getRuntimeEnv("SCOUT_CREDENTIAL_MASTER_KEY_V1"),
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
  };

  return { ...accountPasswordTools, ...serviceAccountTools };
}
