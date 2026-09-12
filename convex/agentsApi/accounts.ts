"use node";

import type { ToolSet } from "ai";
import { omitNullish } from "../../shared/omitNullish";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getRuntimeEnv } from "../runtimeEnv";
import {
  createAccountPasswordFillTool,
  createAccountPasswordPreparationTool,
  requirePasswordInputType,
} from "../scout/accountPasswordTool";
import { assertCredentialBrowserUrl, decryptRuntimeManagedPassword } from "../scout/accountTools";
import type { createBrowserHarness } from "../scout/browserTools";
import { prepareManagedPassword } from "../scout/serviceAccountCredentialActions";
import { createServiceAccountRecordingTool } from "../scout/serviceAccountTool";

export function createAgentsAccountTools(
  ctx: ActionCtx,
  {
    sessionId,
    scout,
    browser,
  }: {
    sessionId: Id<"agentsApiSessions">;
    scout: Doc<"scouts">;
    browser: ReturnType<typeof createBrowserHarness>;
  },
) {
  async function currentScope(abortSignal?: AbortSignal) {
    const currentUrl = await browser.actions.getPage("url", abortSignal);
    if (!currentUrl.success) throw new Error("The current browser URL could not be verified");
    abortSignal?.throwIfAborted();
    return { sessionId, scoutId: scout._id, observedUrl: currentUrl.output };
  }

  const prepare = createAccountPasswordPreparationTool(async (account, abortSignal) => {
    const scope = await currentScope(abortSignal);
    const result = await prepareManagedPassword(ctx, { kind: "agents_api", ...scope, ...account });
    return {
      serviceAccountId: result.serviceAccountId,
      credentialHost: result.loginMethod.credentialHost,
    };
  });

  return {
    prepare_account_password: prepare,
    fill_account_password: createAccountPasswordFillTool(
      async (targets, toolCallId, abortSignal) => {
        const scope = await currentScope(abortSignal);
        const credential = await ctx.runQuery(
          internal.agentsApi.accountsState.credentialForSession,
          scope,
        );
        assertCredentialBrowserUrl(scope.observedUrl, credential.credentialHost);
        for (const target of [targets.passwordTarget, targets.passwordConfirmationTarget]) {
          if (!target) continue;
          const field = await browser.actions.getElementAttribute(target, "type", abortSignal);
          if (!field.success)
            throw new Error("The configured password field could not be verified");
          requirePasswordInputType(field.output);
        }
        const verifiedScope = await currentScope(abortSignal);
        assertCredentialBrowserUrl(verifiedScope.observedUrl, credential.credentialHost);
        let password: string;
        try {
          password = decryptRuntimeManagedPassword(
            credential,
            scout._id,
            getRuntimeEnv("SCOUT_CREDENTIAL_MASTER_KEY_V1"),
          );
        } catch {
          throw new Error("Managed password fill is unavailable");
        }
        browser.actions.registerSensitiveValue(password);
        abortSignal?.throwIfAborted();
        const filled = await browser.actions.fillManagedPassword(
          {
            passwordTarget: targets.passwordTarget,
            ...omitNullish({ passwordConfirmationTarget: targets.passwordConfirmationTarget }),
          },
          password,
          toolCallId,
          abortSignal,
        );
        if (!filled.success) throw new Error("The configured account password could not be filled");
        return { filledFields: targets.passwordConfirmationTarget ? 2 : 1 };
      },
    ),
    record_authenticated_service_account: createServiceAccountRecordingTool(
      async ({ identifier, loginMethod }, abortSignal) => {
        const observationStartedAt = Date.now();
        const scope = await currentScope(abortSignal);
        return await ctx.runMutation(internal.agentsApi.accountsState.recordAuthenticated, {
          ...scope,
          identifier,
          loginMethod,
          observationStartedAt,
        });
      },
    ),
  } satisfies ToolSet;
}
