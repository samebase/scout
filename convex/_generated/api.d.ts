/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as accessModel from "../accessModel.js";
import type * as accountDeletion from "../accountDeletion.js";
import type * as accountDeletionCleanup from "../accountDeletionCleanup.js";
import type * as accounts from "../accounts.js";
import type * as auth from "../auth.js";
import type * as authEmail from "../authEmail.js";
import type * as authEmailRateLimit from "../authEmailRateLimit.js";
import type * as authEmails from "../authEmails.js";
import type * as browserModel from "../browserModel.js";
import type * as browserReplay from "../browserReplay.js";
import type * as devAuth from "../devAuth.js";
import type * as devAuthConfig from "../devAuthConfig.js";
import type * as email from "../email.js";
import type * as functions from "../functions.js";
import type * as http from "../http.js";
import type * as humanHandoffAccess from "../humanHandoffAccess.js";
import type * as humanHandoffBrowser from "../humanHandoffBrowser.js";
import type * as humanHandoffDelivery from "../humanHandoffDelivery.js";
import type * as humanHandoffDeliveryModel from "../humanHandoffDeliveryModel.js";
import type * as humanHandoffDeliveryWorkflow from "../humanHandoffDeliveryWorkflow.js";
import type * as humanHandoffLifecycle from "../humanHandoffLifecycle.js";
import type * as humanHandoffWorkflow from "../humanHandoffWorkflow.js";
import type * as humanHandoffs from "../humanHandoffs.js";
import type * as humanHandoffsModel from "../humanHandoffsModel.js";
import type * as runtimeEnv from "../runtimeEnv.js";
import type * as scout_accountPasswordTool from "../scout/accountPasswordTool.js";
import type * as scout_accountTools from "../scout/accountTools.js";
import type * as scout_agent from "../scout/agent.js";
import type * as scout_agentMailToolInput from "../scout/agentMailToolInput.js";
import type * as scout_agentMailTools from "../scout/agentMailTools.js";
import type * as scout_browserClickRecorder from "../scout/browserClickRecorder.js";
import type * as scout_browserContext from "../scout/browserContext.js";
import type * as scout_browserSessionConnection from "../scout/browserSessionConnection.js";
import type * as scout_browserSessions from "../scout/browserSessions.js";
import type * as scout_browserTarget from "../scout/browserTarget.js";
import type * as scout_browserToolContract from "../scout/browserToolContract.js";
import type * as scout_browserTools from "../scout/browserTools.js";
import type * as scout_chatAccess from "../scout/chatAccess.js";
import type * as scout_chats from "../scout/chats.js";
import type * as scout_compactionContext from "../scout/compactionContext.js";
import type * as scout_compactions from "../scout/compactions.js";
import type * as scout_credentialCrypto from "../scout/credentialCrypto.js";
import type * as scout_generation from "../scout/generation.js";
import type * as scout_humanHandoffInput from "../scout/humanHandoffInput.js";
import type * as scout_humanHandoffTool from "../scout/humanHandoffTool.js";
import type * as scout_lib_agentMail from "../scout/lib/agentMail.js";
import type * as scout_lib_firecrawl from "../scout/lib/firecrawl.js";
import type * as scout_lib_firecrawlCdpUrl from "../scout/lib/firecrawlCdpUrl.js";
import type * as scout_lib_firecrawlLiveView from "../scout/lib/firecrawlLiveView.js";
import type * as scout_lib_firecrawlReplay from "../scout/lib/firecrawlReplay.js";
import type * as scout_lib_humanHandoffAccess from "../scout/lib/humanHandoffAccess.js";
import type * as scout_lib_humanHandoffUrl from "../scout/lib/humanHandoffUrl.js";
import type * as scout_lib_redaction from "../scout/lib/redaction.js";
import type * as scout_lib_runtimeTool from "../scout/lib/runtimeTool.js";
import type * as scout_manual from "../scout/manual.js";
import type * as scout_manualState from "../scout/manualState.js";
import type * as scout_model from "../scout/model.js";
import type * as scout_modelCalls from "../scout/modelCalls.js";
import type * as scout_modelContext from "../scout/modelContext.js";
import type * as scout_models from "../scout/models.js";
import type * as scout_play from "../scout/play.js";
import type * as scout_playwrightBrowser from "../scout/playwrightBrowser.js";
import type * as scout_runtimeInstructions from "../scout/runtimeInstructions.js";
import type * as scout_scoutRegistration from "../scout/scoutRegistration.js";
import type * as scout_scouts from "../scout/scouts.js";
import type * as scout_serviceAccountCredentialActions from "../scout/serviceAccountCredentialActions.js";
import type * as scout_serviceAccountCredentials from "../scout/serviceAccountCredentials.js";
import type * as scout_serviceAccountTool from "../scout/serviceAccountTool.js";
import type * as scout_serviceAccounts from "../scout/serviceAccounts.js";
import type * as scout_skills from "../scout/skills.js";
import type * as scout_toolArgumentProbe from "../scout/toolArgumentProbe.js";
import type * as scout_toolCallRepair from "../scout/toolCallRepair.js";
import type * as scout_toolResults from "../scout/toolResults.js";
import type * as scout_turnLifecycle from "../scout/turnLifecycle.js";
import type * as scout_turnWorkflow from "../scout/turnWorkflow.js";
import type * as scout_turns from "../scout/turns.js";
import type * as scout_webTools from "../scout/webTools.js";
import type * as scout_workspaceFs from "../scout/workspaceFs.js";
import type * as scout_workspaceShell from "../scout/workspaceShell.js";
import type * as scout_workspaceTools from "../scout/workspaceTools.js";
import type * as scout_workspaces from "../scout/workspaces.js";
import type * as serviceDomains from "../serviceDomains.js";
import type * as testing_accounts from "../testing/accounts.js";
import type * as workspaceModel from "../workspaceModel.js";
import type * as workspaceStorage from "../workspaceStorage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  accessModel: typeof accessModel;
  accountDeletion: typeof accountDeletion;
  accountDeletionCleanup: typeof accountDeletionCleanup;
  accounts: typeof accounts;
  auth: typeof auth;
  authEmail: typeof authEmail;
  authEmailRateLimit: typeof authEmailRateLimit;
  authEmails: typeof authEmails;
  browserModel: typeof browserModel;
  browserReplay: typeof browserReplay;
  devAuth: typeof devAuth;
  devAuthConfig: typeof devAuthConfig;
  email: typeof email;
  functions: typeof functions;
  http: typeof http;
  humanHandoffAccess: typeof humanHandoffAccess;
  humanHandoffBrowser: typeof humanHandoffBrowser;
  humanHandoffDelivery: typeof humanHandoffDelivery;
  humanHandoffDeliveryModel: typeof humanHandoffDeliveryModel;
  humanHandoffDeliveryWorkflow: typeof humanHandoffDeliveryWorkflow;
  humanHandoffLifecycle: typeof humanHandoffLifecycle;
  humanHandoffWorkflow: typeof humanHandoffWorkflow;
  humanHandoffs: typeof humanHandoffs;
  humanHandoffsModel: typeof humanHandoffsModel;
  runtimeEnv: typeof runtimeEnv;
  "scout/accountPasswordTool": typeof scout_accountPasswordTool;
  "scout/accountTools": typeof scout_accountTools;
  "scout/agent": typeof scout_agent;
  "scout/agentMailToolInput": typeof scout_agentMailToolInput;
  "scout/agentMailTools": typeof scout_agentMailTools;
  "scout/browserClickRecorder": typeof scout_browserClickRecorder;
  "scout/browserContext": typeof scout_browserContext;
  "scout/browserSessionConnection": typeof scout_browserSessionConnection;
  "scout/browserSessions": typeof scout_browserSessions;
  "scout/browserTarget": typeof scout_browserTarget;
  "scout/browserToolContract": typeof scout_browserToolContract;
  "scout/browserTools": typeof scout_browserTools;
  "scout/chatAccess": typeof scout_chatAccess;
  "scout/chats": typeof scout_chats;
  "scout/compactionContext": typeof scout_compactionContext;
  "scout/compactions": typeof scout_compactions;
  "scout/credentialCrypto": typeof scout_credentialCrypto;
  "scout/generation": typeof scout_generation;
  "scout/humanHandoffInput": typeof scout_humanHandoffInput;
  "scout/humanHandoffTool": typeof scout_humanHandoffTool;
  "scout/lib/agentMail": typeof scout_lib_agentMail;
  "scout/lib/firecrawl": typeof scout_lib_firecrawl;
  "scout/lib/firecrawlCdpUrl": typeof scout_lib_firecrawlCdpUrl;
  "scout/lib/firecrawlLiveView": typeof scout_lib_firecrawlLiveView;
  "scout/lib/firecrawlReplay": typeof scout_lib_firecrawlReplay;
  "scout/lib/humanHandoffAccess": typeof scout_lib_humanHandoffAccess;
  "scout/lib/humanHandoffUrl": typeof scout_lib_humanHandoffUrl;
  "scout/lib/redaction": typeof scout_lib_redaction;
  "scout/lib/runtimeTool": typeof scout_lib_runtimeTool;
  "scout/manual": typeof scout_manual;
  "scout/manualState": typeof scout_manualState;
  "scout/model": typeof scout_model;
  "scout/modelCalls": typeof scout_modelCalls;
  "scout/modelContext": typeof scout_modelContext;
  "scout/models": typeof scout_models;
  "scout/play": typeof scout_play;
  "scout/playwrightBrowser": typeof scout_playwrightBrowser;
  "scout/runtimeInstructions": typeof scout_runtimeInstructions;
  "scout/scoutRegistration": typeof scout_scoutRegistration;
  "scout/scouts": typeof scout_scouts;
  "scout/serviceAccountCredentialActions": typeof scout_serviceAccountCredentialActions;
  "scout/serviceAccountCredentials": typeof scout_serviceAccountCredentials;
  "scout/serviceAccountTool": typeof scout_serviceAccountTool;
  "scout/serviceAccounts": typeof scout_serviceAccounts;
  "scout/skills": typeof scout_skills;
  "scout/toolArgumentProbe": typeof scout_toolArgumentProbe;
  "scout/toolCallRepair": typeof scout_toolCallRepair;
  "scout/toolResults": typeof scout_toolResults;
  "scout/turnLifecycle": typeof scout_turnLifecycle;
  "scout/turnWorkflow": typeof scout_turnWorkflow;
  "scout/turns": typeof scout_turns;
  "scout/webTools": typeof scout_webTools;
  "scout/workspaceFs": typeof scout_workspaceFs;
  "scout/workspaceShell": typeof scout_workspaceShell;
  "scout/workspaceTools": typeof scout_workspaceTools;
  "scout/workspaces": typeof scout_workspaces;
  serviceDomains: typeof serviceDomains;
  "testing/accounts": typeof testing_accounts;
  workspaceModel: typeof workspaceModel;
  workspaceStorage: typeof workspaceStorage;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
