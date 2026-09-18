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
import type * as humanHandoffBrowser from "../humanHandoffBrowser.js";
import type * as humanHandoffDeliveryModel from "../humanHandoffDeliveryModel.js";
import type * as humanHandoffs from "../humanHandoffs.js";
import type * as humanHandoffsModel from "../humanHandoffsModel.js";
import type * as runtimeEnv from "../runtimeEnv.js";
import type * as scout_accountPasswordTool from "../scout/accountPasswordTool.js";
import type * as scout_accountTools from "../scout/accountTools.js";
import type * as scout_activity from "../scout/activity.js";
import type * as scout_agentMailToolInput from "../scout/agentMailToolInput.js";
import type * as scout_agentMailTools from "../scout/agentMailTools.js";
import type * as scout_availability from "../scout/availability.js";
import type * as scout_browserClickRecorder from "../scout/browserClickRecorder.js";
import type * as scout_browserContext from "../scout/browserContext.js";
import type * as scout_browserSessionConnection from "../scout/browserSessionConnection.js";
import type * as scout_browserSessions from "../scout/browserSessions.js";
import type * as scout_browserTarget from "../scout/browserTarget.js";
import type * as scout_browserToolContract from "../scout/browserToolContract.js";
import type * as scout_browserTools from "../scout/browserTools.js";
import type * as scout_chatAccess from "../scout/chatAccess.js";
import type * as scout_chatModel from "../scout/chatModel.js";
import type * as scout_chats from "../scout/chats.js";
import type * as scout_credentialCrypto from "../scout/credentialCrypto.js";
import type * as scout_lib_agentMail from "../scout/lib/agentMail.js";
import type * as scout_lib_firecrawl from "../scout/lib/firecrawl.js";
import type * as scout_lib_firecrawlCdpUrl from "../scout/lib/firecrawlCdpUrl.js";
import type * as scout_lib_firecrawlLiveView from "../scout/lib/firecrawlLiveView.js";
import type * as scout_lib_firecrawlReplay from "../scout/lib/firecrawlReplay.js";
import type * as scout_lib_firecrawlScreenshot from "../scout/lib/firecrawlScreenshot.js";
import type * as scout_lib_humanHandoffUrl from "../scout/lib/humanHandoffUrl.js";
import type * as scout_lib_redaction from "../scout/lib/redaction.js";
import type * as scout_lib_runtimeTool from "../scout/lib/runtimeTool.js";
import type * as scout_model from "../scout/model.js";
import type * as scout_modelCalls from "../scout/modelCalls.js";
import type * as scout_modelContext from "../scout/modelContext.js";
import type * as scout_models from "../scout/models.js";
import type * as scout_play from "../scout/play.js";
import type * as scout_playwrightBrowser from "../scout/playwrightBrowser.js";
import type * as scout_review from "../scout/review.js";
import type * as scout_reviewSites from "../scout/reviewSites.js";
import type * as scout_runtimeInstructions from "../scout/runtimeInstructions.js";
import type * as scout_scoutRegistration from "../scout/scoutRegistration.js";
import type * as scout_scouts from "../scout/scouts.js";
import type * as scout_serviceAccountCredentialActions from "../scout/serviceAccountCredentialActions.js";
import type * as scout_serviceAccountCredentials from "../scout/serviceAccountCredentials.js";
import type * as scout_serviceAccountTool from "../scout/serviceAccountTool.js";
import type * as scout_serviceAccounts from "../scout/serviceAccounts.js";
import type * as scout_siteListings from "../scout/siteListings.js";
import type * as scout_sitePreviewModel from "../scout/sitePreviewModel.js";
import type * as scout_sitePreviewRecords from "../scout/sitePreviewRecords.js";
import type * as scout_sitePreviews from "../scout/sitePreviews.js";
import type * as scout_sites from "../scout/sites.js";
import type * as scout_skills from "../scout/skills.js";
import type * as scout_toolActivity from "../scout/toolActivity.js";
import type * as scout_toolActivityAgents from "../scout/toolActivityAgents.js";
import type * as scout_toolActivityConvex from "../scout/toolActivityConvex.js";
import type * as scout_turnLifecycle from "../scout/turnLifecycle.js";
import type * as scout_turnWorkflow from "../scout/turnWorkflow.js";
import type * as scout_turns from "../scout/turns.js";
import type * as scout_workspaceFs from "../scout/workspaceFs.js";
import type * as scout_workspaceShell from "../scout/workspaceShell.js";
import type * as scout_workspaceTools from "../scout/workspaceTools.js";
import type * as scout_workspaces from "../scout/workspaces.js";
import type * as serviceDomains from "../serviceDomains.js";
import type * as tasks_access from "../tasks/access.js";
import type * as tasks_accounts from "../tasks/accounts.js";
import type * as tasks_accountsState from "../tasks/accountsState.js";
import type * as tasks_agentsApi from "../tasks/agentsApi.js";
import type * as tasks_browsers from "../tasks/browsers.js";
import type * as tasks_client from "../tasks/client.js";
import type * as tasks_convexAgent from "../tasks/convexAgent.js";
import type * as tasks_convexAgentModel from "../tasks/convexAgentModel.js";
import type * as tasks_convexAgentRecords from "../tasks/convexAgentRecords.js";
import type * as tasks_cost from "../tasks/cost.js";
import type * as tasks_events from "../tasks/events.js";
import type * as tasks_execution from "../tasks/execution.js";
import type * as tasks_handoff from "../tasks/handoff.js";
import type * as tasks_handoffEvidence from "../tasks/handoffEvidence.js";
import type * as tasks_handoffEvidenceModel from "../tasks/handoffEvidenceModel.js";
import type * as tasks_instructions from "../tasks/instructions.js";
import type * as tasks_lifecycle from "../tasks/lifecycle.js";
import type * as tasks_model from "../tasks/model.js";
import type * as tasks_output from "../tasks/output.js";
import type * as tasks_requestCheck from "../tasks/requestCheck.js";
import type * as tasks_requestCheckModel from "../tasks/requestCheckModel.js";
import type * as tasks_requestChecks from "../tasks/requestChecks.js";
import type * as tasks_runtime from "../tasks/runtime.js";
import type * as tasks_screenshotModel from "../tasks/screenshotModel.js";
import type * as tasks_screenshotRecords from "../tasks/screenshotRecords.js";
import type * as tasks_screenshots from "../tasks/screenshots.js";
import type * as tasks_sessions from "../tasks/sessions.js";
import type * as tasks_siteResearch from "../tasks/siteResearch.js";
import type * as tasks_siteResearchModel from "../tasks/siteResearchModel.js";
import type * as tasks_siteResearchRecords from "../tasks/siteResearchRecords.js";
import type * as tasks_siteResearchSources from "../tasks/siteResearchSources.js";
import type * as tasks_toolCallRepair from "../tasks/toolCallRepair.js";
import type * as tasks_tools from "../tasks/tools.js";
import type * as tasks_walkthrough from "../tasks/walkthrough.js";
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
  humanHandoffBrowser: typeof humanHandoffBrowser;
  humanHandoffDeliveryModel: typeof humanHandoffDeliveryModel;
  humanHandoffs: typeof humanHandoffs;
  humanHandoffsModel: typeof humanHandoffsModel;
  runtimeEnv: typeof runtimeEnv;
  "scout/accountPasswordTool": typeof scout_accountPasswordTool;
  "scout/accountTools": typeof scout_accountTools;
  "scout/activity": typeof scout_activity;
  "scout/agentMailToolInput": typeof scout_agentMailToolInput;
  "scout/agentMailTools": typeof scout_agentMailTools;
  "scout/availability": typeof scout_availability;
  "scout/browserClickRecorder": typeof scout_browserClickRecorder;
  "scout/browserContext": typeof scout_browserContext;
  "scout/browserSessionConnection": typeof scout_browserSessionConnection;
  "scout/browserSessions": typeof scout_browserSessions;
  "scout/browserTarget": typeof scout_browserTarget;
  "scout/browserToolContract": typeof scout_browserToolContract;
  "scout/browserTools": typeof scout_browserTools;
  "scout/chatAccess": typeof scout_chatAccess;
  "scout/chatModel": typeof scout_chatModel;
  "scout/chats": typeof scout_chats;
  "scout/credentialCrypto": typeof scout_credentialCrypto;
  "scout/lib/agentMail": typeof scout_lib_agentMail;
  "scout/lib/firecrawl": typeof scout_lib_firecrawl;
  "scout/lib/firecrawlCdpUrl": typeof scout_lib_firecrawlCdpUrl;
  "scout/lib/firecrawlLiveView": typeof scout_lib_firecrawlLiveView;
  "scout/lib/firecrawlReplay": typeof scout_lib_firecrawlReplay;
  "scout/lib/firecrawlScreenshot": typeof scout_lib_firecrawlScreenshot;
  "scout/lib/humanHandoffUrl": typeof scout_lib_humanHandoffUrl;
  "scout/lib/redaction": typeof scout_lib_redaction;
  "scout/lib/runtimeTool": typeof scout_lib_runtimeTool;
  "scout/model": typeof scout_model;
  "scout/modelCalls": typeof scout_modelCalls;
  "scout/modelContext": typeof scout_modelContext;
  "scout/models": typeof scout_models;
  "scout/play": typeof scout_play;
  "scout/playwrightBrowser": typeof scout_playwrightBrowser;
  "scout/review": typeof scout_review;
  "scout/reviewSites": typeof scout_reviewSites;
  "scout/runtimeInstructions": typeof scout_runtimeInstructions;
  "scout/scoutRegistration": typeof scout_scoutRegistration;
  "scout/scouts": typeof scout_scouts;
  "scout/serviceAccountCredentialActions": typeof scout_serviceAccountCredentialActions;
  "scout/serviceAccountCredentials": typeof scout_serviceAccountCredentials;
  "scout/serviceAccountTool": typeof scout_serviceAccountTool;
  "scout/serviceAccounts": typeof scout_serviceAccounts;
  "scout/siteListings": typeof scout_siteListings;
  "scout/sitePreviewModel": typeof scout_sitePreviewModel;
  "scout/sitePreviewRecords": typeof scout_sitePreviewRecords;
  "scout/sitePreviews": typeof scout_sitePreviews;
  "scout/sites": typeof scout_sites;
  "scout/skills": typeof scout_skills;
  "scout/toolActivity": typeof scout_toolActivity;
  "scout/toolActivityAgents": typeof scout_toolActivityAgents;
  "scout/toolActivityConvex": typeof scout_toolActivityConvex;
  "scout/turnLifecycle": typeof scout_turnLifecycle;
  "scout/turnWorkflow": typeof scout_turnWorkflow;
  "scout/turns": typeof scout_turns;
  "scout/workspaceFs": typeof scout_workspaceFs;
  "scout/workspaceShell": typeof scout_workspaceShell;
  "scout/workspaceTools": typeof scout_workspaceTools;
  "scout/workspaces": typeof scout_workspaces;
  serviceDomains: typeof serviceDomains;
  "tasks/access": typeof tasks_access;
  "tasks/accounts": typeof tasks_accounts;
  "tasks/accountsState": typeof tasks_accountsState;
  "tasks/agentsApi": typeof tasks_agentsApi;
  "tasks/browsers": typeof tasks_browsers;
  "tasks/client": typeof tasks_client;
  "tasks/convexAgent": typeof tasks_convexAgent;
  "tasks/convexAgentModel": typeof tasks_convexAgentModel;
  "tasks/convexAgentRecords": typeof tasks_convexAgentRecords;
  "tasks/cost": typeof tasks_cost;
  "tasks/events": typeof tasks_events;
  "tasks/execution": typeof tasks_execution;
  "tasks/handoff": typeof tasks_handoff;
  "tasks/handoffEvidence": typeof tasks_handoffEvidence;
  "tasks/handoffEvidenceModel": typeof tasks_handoffEvidenceModel;
  "tasks/instructions": typeof tasks_instructions;
  "tasks/lifecycle": typeof tasks_lifecycle;
  "tasks/model": typeof tasks_model;
  "tasks/output": typeof tasks_output;
  "tasks/requestCheck": typeof tasks_requestCheck;
  "tasks/requestCheckModel": typeof tasks_requestCheckModel;
  "tasks/requestChecks": typeof tasks_requestChecks;
  "tasks/runtime": typeof tasks_runtime;
  "tasks/screenshotModel": typeof tasks_screenshotModel;
  "tasks/screenshotRecords": typeof tasks_screenshotRecords;
  "tasks/screenshots": typeof tasks_screenshots;
  "tasks/sessions": typeof tasks_sessions;
  "tasks/siteResearch": typeof tasks_siteResearch;
  "tasks/siteResearchModel": typeof tasks_siteResearchModel;
  "tasks/siteResearchRecords": typeof tasks_siteResearchRecords;
  "tasks/siteResearchSources": typeof tasks_siteResearchSources;
  "tasks/toolCallRepair": typeof tasks_toolCallRepair;
  "tasks/tools": typeof tasks_tools;
  "tasks/walkthrough": typeof tasks_walkthrough;
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
