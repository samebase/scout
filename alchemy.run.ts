// The stack of TrailScout. .github/workflows/alchemy.yml runs it from the repository root:
//
// - Stage `prod`, on each push to main: the production deployment, its R2 buckets, and the account
//   API token that production sends email with.
// - Stage `pr-<number>`, on each pull request: a Convex preview deployment with the name of the
//   stage, which `alchemy destroy` deletes when the pull request closes.
//
// Google sign-in is at https://login.samebase.com, with no registration: each push runs
// apps/scout/scripts/ensure-convex-auth.ts, which sets OAUTH_CLIENT_ID to the address of the
// site's metadata document.
//
// A stage deployed before the sign-in at login.samebase.com holds the client "HubClient" at
// id.samebase.com, and its "Site" row wrote the three IDENTITY_BROKER_ variables. "HubClient" is
// gone from the stack, so this deploy deletes it with the provider of IdentityBroker.providers():
// a preview's client at the broker too, and production's only in state, because the broker refuses
// that delete. "Site" no longer lists the three variables, so it removes them after the push. Once
// every stage ran this version, a later version drops the provider and the preview's "Site" row.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Convex from "@samebase/alchemy-convex";
import * as IdentityBroker from "@samebase/identity-broker/alchemy";
import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// The commit of this checkout: SCOUT_COMMIT on each deployment. It is in the env of "Push" and
// "Preview", so it is part of each push's hash: every commit deploys, also one that changes only
// files outside apps/scout.
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

/**
The custom domain of production. The Convex dashboard overrides CONVEX_SITE_URL to it, so Convex
Auth keeps its issuer, and the sign-in's metadata document and callback are on it.
*/
const PRODUCTION_SITE_URL = "https://scout.samebase.com";

/** The file of `npx convex dev`, which selects the development deployment. CI has none. */
const APP_ENV_LOCAL = "apps/scout/.env.local";
const envLocal = existsSync(APP_ENV_LOCAL) ? parseEnv(readFileSync(APP_ENV_LOCAL, "utf8")) : {};
// With the Convex CLI login, alchemy-convex takes the team of the deployment in CONVEX_DEPLOYMENT,
// from the environment or from .env.local of the working directory. This stack runs at the
// repository root, and the app's .env.local is in apps/scout.
const selectedDeployment = envLocal["CONVEX_DEPLOYMENT"];
if (selectedDeployment !== undefined) process.env["CONVEX_DEPLOYMENT"] ??= selectedDeployment;

export default Alchemy.Stack(
  "samebase/scout",
  {
    // The GitHub provider has no resource here: it forgets the PreviewComment rows of older previews.
    providers: Layer.mergeAll(
      Convex.providers(),
      IdentityBroker.providers(),
      Cloudflare.providers(),
      GitHub.providers(),
    ),
    state: Convex.withRunRecord(Convex.state()),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;

    if (stage === "prod") {
      const bucketSettings = {
        storageClass: "Standard",
        jurisdiction: "default",
        publicAccess: false,
        cors: [],
        domains: [],
        lifecycleRules: [
          {
            id: "Default Multipart Abort Rule",
            enabled: true,
            prefix: "",
            abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 604800 } },
          },
        ],
      } satisfies Cloudflare.R2.BucketProps;

      yield* Cloudflare.R2.Bucket("ProductionWorkspaceBucket", {
        ...bucketSettings,
        name: "scout-workspaces-prod",
      }).pipe(Alchemy.RemovalPolicy.retain());
      yield* Cloudflare.R2.Bucket("DevelopmentWorkspaceBucket", {
        ...bucketSettings,
        name: "scout-workspaces",
      }).pipe(Alchemy.RemovalPolicy.retain());
      yield* Cloudflare.R2.Bucket("PublicMediaBucket", {
        ...bucketSettings,
        name: "scout-public-media",
        domains: [
          {
            name: "scout-media.samebase.com",
            zone: "2f2e7713e926a7282b25796b02826f02",
            enabled: true,
            minTLS: "1.2",
          },
        ],
      }).pipe(Alchemy.RemovalPolicy.retain());
    }

    // A slug selects the existing project without creating, renaming, or deleting it.
    const project = yield* Convex.Project("Project", { slug: "scout" }).pipe(
      adopt(true),
      Alchemy.RemovalPolicy.retain(),
    );

    if (stage === "prod") {
      // "Push" pushes the code. Its one variable is SCOUT_COMMIT, which "Site" also sets with the
      // same value: it is in the push's hash, so every commit pushes. adopt(true) takes over the
      // production deployment, which has code. Retained with Site.
      const push = yield* Convex.Deployment("Push", {
        project,
        type: "prod",
        rootDir: "apps/scout",
        env: { SCOUT_COMMIT: commit },
        source: { path: "./convex", command: ["node", "--run", "deploy"] },
      }).pipe(adopt(true), Alchemy.RemovalPolicy.retain());
      // convex/email.ts sends authentication email with this account token, which can only send
      // email. Minting it needs Account API Tokens Write on the CI token. Cloudflare returns the
      // value only on creation: the resource keeps it in state, and an update, such as a new name
      // or policy, keeps that value. A deploy mints a new token only when this one is gone.
      // Retained with Site: a destroy of this stage must not revoke the token production sends with.
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const emailToken = yield* Cloudflare.ApiToken.AccountApiToken("EmailToken", {
        name: "scout production email sending",
        policies: [
          {
            effect: "allow",
            permissionGroups: ["Email Sending Write"],
            resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
          },
        ],
      }).pipe(Alchemy.RemovalPolicy.retain());
      // "Site" writes the variables, with no push. The hash of the push orders it after the push:
      // Convex refuses to remove a variable that the old code requires.
      yield* Convex.Deployment("Site", {
        project: {
          projectId: Output.map(Output.all(push.projectId, push.hash), ([projectId]) => projectId),
        },
        type: "prod",
        rootDir: "apps/scout",
        env: {
          SCOUT_COMMIT: commit,
          SITE_URL: PRODUCTION_SITE_URL,
          CLOUDFLARE_EMAIL_ACCOUNT_ID: accountId,
          CLOUDFLARE_EMAIL_API_TOKEN: emailToken.value,
        },
      }).pipe(adopt(true), Alchemy.RemovalPolicy.retain());
      return { url: PRODUCTION_SITE_URL };
    }

    // "Preview" creates the deployment and pushes: the push command also sets SITE_URL to the
    // preview's site and seeds the password account. adopt(true) also takes over a preview with the
    // name of this stage that an earlier run created.
    const preview = yield* Convex.Deployment("Preview", {
      project,
      type: "preview",
      name: stage,
      rootDir: "apps/scout",
      env: { SCOUT_COMMIT: commit },
      source: { path: "./convex", command: ["node", "./scripts/deploy-preview.ts"] },
    }).pipe(adopt(true), Alchemy.RemovalPolicy.destroy());
    // Only for the cleanup above, after the push, and retained, so a later version can drop it
    // without deleting the deployment. It keeps SCOUT_COMMIT, which it set before.
    yield* Convex.Deployment("Site", {
      project: {
        projectId: Output.map(
          Output.all(preview.projectId, preview.hash),
          ([projectId]) => projectId,
        ),
      },
      type: "preview",
      name: stage,
      rootDir: "apps/scout",
      env: { SCOUT_COMMIT: commit },
    }).pipe(adopt(true), Alchemy.RemovalPolicy.retain());

    return { url: preview.siteUrl };
  }),
);
