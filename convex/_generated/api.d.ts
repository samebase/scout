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
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as scout_browser from "../scout/browser.js";
import type * as scout_lib_agentmail from "../scout/lib/agentmail.js";
import type * as scout_lib_emailLinks from "../scout/lib/emailLinks.js";
import type * as scout_lib_firecrawl from "../scout/lib/firecrawl.js";
import type * as scout_lib_http from "../scout/lib/http.js";
import type * as scout_mail from "../scout/mail.js";
import type * as scout_model from "../scout/model.js";
import type * as scout_runs from "../scout/runs.js";

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
  email: typeof email;
  http: typeof http;
  "scout/browser": typeof scout_browser;
  "scout/lib/agentmail": typeof scout_lib_agentmail;
  "scout/lib/emailLinks": typeof scout_lib_emailLinks;
  "scout/lib/firecrawl": typeof scout_lib_firecrawl;
  "scout/lib/http": typeof scout_lib_http;
  "scout/mail": typeof scout_mail;
  "scout/model": typeof scout_model;
  "scout/runs": typeof scout_runs;
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
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
