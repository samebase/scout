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
import type * as auth from "../auth.js";
import type * as authConfig from "../authConfig.js";
import type * as authEmail from "../authEmail.js";
import type * as authEmailRateLimit from "../authEmailRateLimit.js";
import type * as authEmails from "../authEmails.js";
import type * as browserModel from "../browserModel.js";
import type * as browserReplay from "../browserReplay.js";
import type * as devAuth from "../devAuth.js";
import type * as devAuthConfig from "../devAuthConfig.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as humanHandoffAccess from "../humanHandoffAccess.js";
import type * as humanHandoffBrowser from "../humanHandoffBrowser.js";
import type * as humanHandoffLifecycle from "../humanHandoffLifecycle.js";
import type * as humanHandoffWorkflow from "../humanHandoffWorkflow.js";
import type * as humanHandoffs from "../humanHandoffs.js";
import type * as humanHandoffsModel from "../humanHandoffsModel.js";
import type * as scout_accountPasswordTool from "../scout/accountPasswordTool.js";
import type * as scout_accountTools from "../scout/accountTools.js";
import type * as scout_agent from "../scout/agent.js";
import type * as scout_browserContext from "../scout/browserContext.js";
import type * as scout_browserSessions from "../scout/browserSessions.js";
import type * as scout_browserTarget from "../scout/browserTarget.js";
import type * as scout_browserToolContract from "../scout/browserToolContract.js";
import type * as scout_browserTools from "../scout/browserTools.js";
import type * as scout_chatAccess from "../scout/chatAccess.js";
import type * as scout_chats from "../scout/chats.js";
import type * as scout_credentialCrypto from "../scout/credentialCrypto.js";
import type * as scout_generation from "../scout/generation.js";
import type * as scout_humanHandoffTool from "../scout/humanHandoffTool.js";
import type * as scout_lib_firecrawl from "../scout/lib/firecrawl.js";
import type * as scout_lib_firecrawlLiveView from "../scout/lib/firecrawlLiveView.js";
import type * as scout_lib_firecrawlReplay from "../scout/lib/firecrawlReplay.js";
import type * as scout_lib_humanHandoffAccess from "../scout/lib/humanHandoffAccess.js";
import type * as scout_lib_redaction from "../scout/lib/redaction.js";
import type * as scout_manual from "../scout/manual.js";
import type * as scout_manualState from "../scout/manualState.js";
import type * as scout_model from "../scout/model.js";
import type * as scout_models from "../scout/models.js";
import type * as scout_playwrightBrowser from "../scout/playwrightBrowser.js";
import type * as scout_runtimeInstructions from "../scout/runtimeInstructions.js";
import type * as scout_scouts from "../scout/scouts.js";
import type * as scout_serviceAccountCredentialActions from "../scout/serviceAccountCredentialActions.js";
import type * as scout_serviceAccountCredentials from "../scout/serviceAccountCredentials.js";
import type * as scout_serviceAccountTool from "../scout/serviceAccountTool.js";
import type * as scout_serviceAccounts from "../scout/serviceAccounts.js";
import type * as scout_toolArgumentProbe from "../scout/toolArgumentProbe.js";
import type * as scout_toolCallRepair from "../scout/toolCallRepair.js";
import type * as scout_turns from "../scout/turns.js";
import type * as scout_webTools from "../scout/webTools.js";
import type * as serviceDomains from "../serviceDomains.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  authConfig: typeof authConfig;
  authEmail: typeof authEmail;
  authEmailRateLimit: typeof authEmailRateLimit;
  authEmails: typeof authEmails;
  browserModel: typeof browserModel;
  browserReplay: typeof browserReplay;
  devAuth: typeof devAuth;
  devAuthConfig: typeof devAuthConfig;
  email: typeof email;
  http: typeof http;
  humanHandoffAccess: typeof humanHandoffAccess;
  humanHandoffBrowser: typeof humanHandoffBrowser;
  humanHandoffLifecycle: typeof humanHandoffLifecycle;
  humanHandoffWorkflow: typeof humanHandoffWorkflow;
  humanHandoffs: typeof humanHandoffs;
  humanHandoffsModel: typeof humanHandoffsModel;
  "scout/accountPasswordTool": typeof scout_accountPasswordTool;
  "scout/accountTools": typeof scout_accountTools;
  "scout/agent": typeof scout_agent;
  "scout/browserContext": typeof scout_browserContext;
  "scout/browserSessions": typeof scout_browserSessions;
  "scout/browserTarget": typeof scout_browserTarget;
  "scout/browserToolContract": typeof scout_browserToolContract;
  "scout/browserTools": typeof scout_browserTools;
  "scout/chatAccess": typeof scout_chatAccess;
  "scout/chats": typeof scout_chats;
  "scout/credentialCrypto": typeof scout_credentialCrypto;
  "scout/generation": typeof scout_generation;
  "scout/humanHandoffTool": typeof scout_humanHandoffTool;
  "scout/lib/firecrawl": typeof scout_lib_firecrawl;
  "scout/lib/firecrawlLiveView": typeof scout_lib_firecrawlLiveView;
  "scout/lib/firecrawlReplay": typeof scout_lib_firecrawlReplay;
  "scout/lib/humanHandoffAccess": typeof scout_lib_humanHandoffAccess;
  "scout/lib/redaction": typeof scout_lib_redaction;
  "scout/manual": typeof scout_manual;
  "scout/manualState": typeof scout_manualState;
  "scout/model": typeof scout_model;
  "scout/models": typeof scout_models;
  "scout/playwrightBrowser": typeof scout_playwrightBrowser;
  "scout/runtimeInstructions": typeof scout_runtimeInstructions;
  "scout/scouts": typeof scout_scouts;
  "scout/serviceAccountCredentialActions": typeof scout_serviceAccountCredentialActions;
  "scout/serviceAccountCredentials": typeof scout_serviceAccountCredentials;
  "scout/serviceAccountTool": typeof scout_serviceAccountTool;
  "scout/serviceAccounts": typeof scout_serviceAccounts;
  "scout/toolArgumentProbe": typeof scout_toolArgumentProbe;
  "scout/toolCallRepair": typeof scout_toolCallRepair;
  "scout/turns": typeof scout_turns;
  "scout/webTools": typeof scout_webTools;
  serviceDomains: typeof serviceDomains;
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
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
