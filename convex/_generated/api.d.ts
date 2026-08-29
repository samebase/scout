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
import type * as productResearchAgent from "../productResearchAgent.js";
import type * as products from "../products.js";
import type * as productsDomain from "../productsDomain.js";
import type * as productsInvestigation from "../productsInvestigation.js";
import type * as productsModel from "../productsModel.js";
import type * as productsResearch from "../productsResearch.js";
import type * as productsValidation from "../productsValidation.js";
import type * as scout_agent from "../scout/agent.js";
import type * as scout_lab from "../scout/lab.js";
import type * as scout_labAccess from "../scout/labAccess.js";
import type * as scout_labGeneration from "../scout/labGeneration.js";
import type * as scout_labTools from "../scout/labTools.js";
import type * as scout_lib_firecrawl from "../scout/lib/firecrawl.js";
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
  devAuth: typeof devAuth;
  devAuthConfig: typeof devAuthConfig;
  email: typeof email;
  http: typeof http;
  productResearchAgent: typeof productResearchAgent;
  products: typeof products;
  productsDomain: typeof productsDomain;
  productsInvestigation: typeof productsInvestigation;
  productsModel: typeof productsModel;
  productsResearch: typeof productsResearch;
  productsValidation: typeof productsValidation;
  "scout/agent": typeof scout_agent;
  "scout/lab": typeof scout_lab;
  "scout/labAccess": typeof scout_labAccess;
  "scout/labGeneration": typeof scout_labGeneration;
  "scout/labTools": typeof scout_labTools;
  "scout/lib/firecrawl": typeof scout_lib_firecrawl;
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
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
