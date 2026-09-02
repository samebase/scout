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
import type * as devAuth from "../devAuth.js";
import type * as devAuthConfig from "../devAuthConfig.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as productInvestigationWorkflow from "../productInvestigationWorkflow.js";
import type * as productResearchAgent from "../productResearchAgent.js";
import type * as products from "../products.js";
import type * as productsDomain from "../productsDomain.js";
import type * as productsInvestigationActivities from "../productsInvestigationActivities.js";
import type * as productsInvestigationActivityModel from "../productsInvestigationActivityModel.js";
import type * as productsInvestigationInspector from "../productsInvestigationInspector.js";
import type * as productsInvestigationWorkflow from "../productsInvestigationWorkflow.js";
import type * as productsModel from "../productsModel.js";
import type * as productsResearch from "../productsResearch.js";
import type * as productsValidation from "../productsValidation.js";
import type * as scout_accountPasswordTool from "../scout/accountPasswordTool.js";
import type * as scout_agent from "../scout/agent.js";
import type * as scout_attemptResolutionTool from "../scout/attemptResolutionTool.js";
import type * as scout_browserTarget from "../scout/browserTarget.js";
import type * as scout_credentialCrypto from "../scout/credentialCrypto.js";
import type * as scout_humanHandoffTool from "../scout/humanHandoffTool.js";
import type * as scout_lab from "../scout/lab.js";
import type * as scout_labAccess from "../scout/labAccess.js";
import type * as scout_labGeneration from "../scout/labGeneration.js";
import type * as scout_labTools from "../scout/labTools.js";
import type * as scout_lib_firecrawl from "../scout/lib/firecrawl.js";
import type * as scout_lib_firecrawlLiveView from "../scout/lib/firecrawlLiveView.js";
import type * as scout_lib_firecrawlReplay from "../scout/lib/firecrawlReplay.js";
import type * as scout_lib_humanHandoffAccess from "../scout/lib/humanHandoffAccess.js";
import type * as scout_lib_redaction from "../scout/lib/redaction.js";
import type * as scout_model from "../scout/model.js";
import type * as scout_models from "../scout/models.js";
import type * as scout_playwrightBrowser from "../scout/playwrightBrowser.js";
import type * as scout_scouts from "../scout/scouts.js";
import type * as scout_serviceAccountCredentialActions from "../scout/serviceAccountCredentialActions.js";
import type * as scout_serviceAccountCredentials from "../scout/serviceAccountCredentials.js";
import type * as scout_serviceAccountTool from "../scout/serviceAccountTool.js";
import type * as scout_serviceAccounts from "../scout/serviceAccounts.js";
import type * as scout_taskLoop from "../scout/taskLoop.js";
import type * as scout_toolArgumentProbe from "../scout/toolArgumentProbe.js";
import type * as scout_toolCallRepair from "../scout/toolCallRepair.js";
import type * as scout_turns from "../scout/turns.js";
import type * as taskAttemptModel from "../taskAttemptModel.js";
import type * as taskBrowserModel from "../taskBrowserModel.js";
import type * as taskHumanHandoffAccess from "../taskHumanHandoffAccess.js";
import type * as taskHumanHandoffBrowser from "../taskHumanHandoffBrowser.js";
import type * as taskHumanHandoffLifecycle from "../taskHumanHandoffLifecycle.js";
import type * as taskHumanHandoffWorkflow from "../taskHumanHandoffWorkflow.js";
import type * as taskHumanHandoffs from "../taskHumanHandoffs.js";
import type * as taskHumanHandoffsModel from "../taskHumanHandoffsModel.js";
import type * as taskReplay from "../taskReplay.js";
import type * as tasks from "../tasks.js";
import type * as tasksModel from "../tasksModel.js";

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
  devAuth: typeof devAuth;
  devAuthConfig: typeof devAuthConfig;
  email: typeof email;
  http: typeof http;
  productInvestigationWorkflow: typeof productInvestigationWorkflow;
  productResearchAgent: typeof productResearchAgent;
  products: typeof products;
  productsDomain: typeof productsDomain;
  productsInvestigationActivities: typeof productsInvestigationActivities;
  productsInvestigationActivityModel: typeof productsInvestigationActivityModel;
  productsInvestigationInspector: typeof productsInvestigationInspector;
  productsInvestigationWorkflow: typeof productsInvestigationWorkflow;
  productsModel: typeof productsModel;
  productsResearch: typeof productsResearch;
  productsValidation: typeof productsValidation;
  "scout/accountPasswordTool": typeof scout_accountPasswordTool;
  "scout/agent": typeof scout_agent;
  "scout/attemptResolutionTool": typeof scout_attemptResolutionTool;
  "scout/browserTarget": typeof scout_browserTarget;
  "scout/credentialCrypto": typeof scout_credentialCrypto;
  "scout/humanHandoffTool": typeof scout_humanHandoffTool;
  "scout/lab": typeof scout_lab;
  "scout/labAccess": typeof scout_labAccess;
  "scout/labGeneration": typeof scout_labGeneration;
  "scout/labTools": typeof scout_labTools;
  "scout/lib/firecrawl": typeof scout_lib_firecrawl;
  "scout/lib/firecrawlLiveView": typeof scout_lib_firecrawlLiveView;
  "scout/lib/firecrawlReplay": typeof scout_lib_firecrawlReplay;
  "scout/lib/humanHandoffAccess": typeof scout_lib_humanHandoffAccess;
  "scout/lib/redaction": typeof scout_lib_redaction;
  "scout/model": typeof scout_model;
  "scout/models": typeof scout_models;
  "scout/playwrightBrowser": typeof scout_playwrightBrowser;
  "scout/scouts": typeof scout_scouts;
  "scout/serviceAccountCredentialActions": typeof scout_serviceAccountCredentialActions;
  "scout/serviceAccountCredentials": typeof scout_serviceAccountCredentials;
  "scout/serviceAccountTool": typeof scout_serviceAccountTool;
  "scout/serviceAccounts": typeof scout_serviceAccounts;
  "scout/taskLoop": typeof scout_taskLoop;
  "scout/toolArgumentProbe": typeof scout_toolArgumentProbe;
  "scout/toolCallRepair": typeof scout_toolCallRepair;
  "scout/turns": typeof scout_turns;
  taskAttemptModel: typeof taskAttemptModel;
  taskBrowserModel: typeof taskBrowserModel;
  taskHumanHandoffAccess: typeof taskHumanHandoffAccess;
  taskHumanHandoffBrowser: typeof taskHumanHandoffBrowser;
  taskHumanHandoffLifecycle: typeof taskHumanHandoffLifecycle;
  taskHumanHandoffWorkflow: typeof taskHumanHandoffWorkflow;
  taskHumanHandoffs: typeof taskHumanHandoffs;
  taskHumanHandoffsModel: typeof taskHumanHandoffsModel;
  taskReplay: typeof taskReplay;
  tasks: typeof tasks;
  tasksModel: typeof tasksModel;
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
