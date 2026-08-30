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
import type * as claimTestBrowserModel from "../claimTestBrowserModel.js";
import type * as claimTestHumanHandoffs from "../claimTestHumanHandoffs.js";
import type * as claimTestHumanHandoffsModel from "../claimTestHumanHandoffsModel.js";
import type * as claimTestReplay from "../claimTestReplay.js";
import type * as claimTests from "../claimTests.js";
import type * as claimTestsModel from "../claimTestsModel.js";
import type * as devAuth from "../devAuth.js";
import type * as devAuthConfig from "../devAuthConfig.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as productClaimEdits from "../productClaimEdits.js";
import type * as productInvestigationWorkflow from "../productInvestigationWorkflow.js";
import type * as productResearchAgent from "../productResearchAgent.js";
import type * as products from "../products.js";
import type * as productsClaims from "../productsClaims.js";
import type * as productsDomain from "../productsDomain.js";
import type * as productsInvestigation from "../productsInvestigation.js";
import type * as productsInvestigationActivities from "../productsInvestigationActivities.js";
import type * as productsInvestigationActivityModel from "../productsInvestigationActivityModel.js";
import type * as productsInvestigationInspector from "../productsInvestigationInspector.js";
import type * as productsInvestigationWorkflow from "../productsInvestigationWorkflow.js";
import type * as productsModel from "../productsModel.js";
import type * as productsResearch from "../productsResearch.js";
import type * as productsValidation from "../productsValidation.js";
import type * as scout_agent from "../scout/agent.js";
import type * as scout_browserTelemetry from "../scout/browserTelemetry.js";
import type * as scout_claimTestLoop from "../scout/claimTestLoop.js";
import type * as scout_humanHandoffTool from "../scout/humanHandoffTool.js";
import type * as scout_lab from "../scout/lab.js";
import type * as scout_labAccess from "../scout/labAccess.js";
import type * as scout_labGeneration from "../scout/labGeneration.js";
import type * as scout_labTools from "../scout/labTools.js";
import type * as scout_lib_firecrawl from "../scout/lib/firecrawl.js";
import type * as scout_lib_firecrawlLiveView from "../scout/lib/firecrawlLiveView.js";
import type * as scout_lib_http from "../scout/lib/http.js";
import type * as scout_lib_redaction from "../scout/lib/redaction.js";
import type * as scout_model from "../scout/model.js";
import type * as scout_models from "../scout/models.js";
import type * as scout_scouts from "../scout/scouts.js";
import type * as scout_serviceAccounts from "../scout/serviceAccounts.js";

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
  claimTestBrowserModel: typeof claimTestBrowserModel;
  claimTestHumanHandoffs: typeof claimTestHumanHandoffs;
  claimTestHumanHandoffsModel: typeof claimTestHumanHandoffsModel;
  claimTestReplay: typeof claimTestReplay;
  claimTests: typeof claimTests;
  claimTestsModel: typeof claimTestsModel;
  devAuth: typeof devAuth;
  devAuthConfig: typeof devAuthConfig;
  email: typeof email;
  http: typeof http;
  productClaimEdits: typeof productClaimEdits;
  productInvestigationWorkflow: typeof productInvestigationWorkflow;
  productResearchAgent: typeof productResearchAgent;
  products: typeof products;
  productsClaims: typeof productsClaims;
  productsDomain: typeof productsDomain;
  productsInvestigation: typeof productsInvestigation;
  productsInvestigationActivities: typeof productsInvestigationActivities;
  productsInvestigationActivityModel: typeof productsInvestigationActivityModel;
  productsInvestigationInspector: typeof productsInvestigationInspector;
  productsInvestigationWorkflow: typeof productsInvestigationWorkflow;
  productsModel: typeof productsModel;
  productsResearch: typeof productsResearch;
  productsValidation: typeof productsValidation;
  "scout/agent": typeof scout_agent;
  "scout/browserTelemetry": typeof scout_browserTelemetry;
  "scout/claimTestLoop": typeof scout_claimTestLoop;
  "scout/humanHandoffTool": typeof scout_humanHandoffTool;
  "scout/lab": typeof scout_lab;
  "scout/labAccess": typeof scout_labAccess;
  "scout/labGeneration": typeof scout_labGeneration;
  "scout/labTools": typeof scout_labTools;
  "scout/lib/firecrawl": typeof scout_lib_firecrawl;
  "scout/lib/firecrawlLiveView": typeof scout_lib_firecrawlLiveView;
  "scout/lib/http": typeof scout_lib_http;
  "scout/lib/redaction": typeof scout_lib_redaction;
  "scout/model": typeof scout_model;
  "scout/models": typeof scout_models;
  "scout/scouts": typeof scout_scouts;
  "scout/serviceAccounts": typeof scout_serviceAccounts;
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
