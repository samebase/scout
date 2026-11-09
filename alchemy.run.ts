// The stack of TrailScout. .github/workflows/alchemy.yml runs it from the repository root:
//
// - Stage `prod`, on each push to main: the production deployment, its R2 buckets, and the account
//   API token that production sends email with.
// - Stage `pr-<number>`, on each pull request: a Convex preview deployment with the name of the
//   stage, which `alchemy destroy` deletes when the pull request closes.
// - Stage `dev-<name>`, on a laptop, run on purpose with
//   `pnpm run identity-hub:dev-client --stage dev-<name>`: the hub client of the development
//   deployment that apps/scout/.env.local selects.
//
// Each deployment has a client of the identity hub at https://auth.samebase.com, for Google
// sign-in (RFC 134). IdentityHub.Client asks `POST /hub-clients` with the GitHub OIDC token of
// the run (`id-token: write` in alchemy.yml), or on a laptop with the app's initial access token
// that the production registration saved. The hub first reads /samebase-verification.json on the
// callback's site (convex/http.ts), so the code with that route is pushed before the client
// registers, and the client's variables are written after it. Each variable stays on the row that
// owned it before: a Convex.Deployment removes a name that leaves its own `env`, after its push
// when it has one. The push runs apps/scout/scripts/ensure-convex-auth.ts, which sets the off values
// of the client's variables when they are missing, so the code loads before "Site" writes them.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Convex from "@samebase/alchemy-convex";
import * as IdentityHub from "@samebase/alchemy-convex/identity-hub";
import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// The commit of this checkout: SCOUT_COMMIT on each deployment, and the software version of each hub
// client. It is in the env of "Push" and "Preview", so it is part of each push's hash: every commit
// deploys, also one that changes only files outside apps/scout.
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

/**
The custom domain of production. The Convex dashboard overrides CONVEX_SITE_URL to it, so Convex
Auth keeps its issuer and builds the hub callback on it, and the hub's page names it.
*/
const PRODUCTION_SITE_URL = "https://scout.samebase.com";
/** The identity hub's callback into Convex Auth, after CONVEX_SITE_URL (convex/convex.config.ts). */
const HUB_CALLBACK_PATH = "/auth/hub/callback";
/**
The name of TrailScout at the identity hub. The hub keeps one initial access token for each
repository and name, which a laptop's stage reads from `prod`.
*/
const IDENTITY_HUB_APP = "trailscout";
/** Samebase's identity hub, where every client of TrailScout registers. */
const HUB = { issuer: "https://auth.samebase.com" };

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
    providers: Layer.mergeAll(Convex.providers(), Cloudflare.providers(), GitHub.providers()),
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

    if (stage.startsWith("dev-")) {
      // A laptop, after one deploy to main and after `pnpm run dev` selected a cloud development
      // deployment and pushed the code. This stage gives that deployment its hub client and
      // nothing else: no new deployment, no push. Both deployment rows keep the default removal
      // policy `retain`: `alchemy destroy --stage dev-<name>` deletes only the hub client.
      const selected = /^dev:(.+)$/.exec(selectedDeployment ?? "")?.[1];
      if (selected === undefined) {
        throw new Error(
          `Run \`pnpm run dev\` once first: ${APP_ENV_LOCAL} selects no cloud development deployment.`,
        );
      }
      // The initial access token that the production registration saved.
      const production = IdentityHub.Client.read("HubClient", { stage: "prod" });
      const development = yield* Convex.Deployment("Development", {
        project,
        type: "dev",
        name: selected,
      }).pipe(adopt(true));
      const signIn = IdentityHub.Client.variables(
        yield* IdentityHub.Client("HubClient", {
          app: IDENTITY_HUB_APP,
          hub: HUB,
          connectors: ["google"],
          redirectUris: [Output.interpolate`${development.siteUrl}${HUB_CALLBACK_PATH}`],
          deploymentType: "development",
          initialAccessToken: production.initialAccessToken,
          softwareVersion: commit,
          // A run that gets no working client fails and keeps the variables the deployment has, in
          // place of writing the off values over a working client.
          required: true,
        }),
      );
      const site = yield* Convex.Deployment("Site", {
        project,
        type: "dev",
        name: selected,
        env: {
          IDENTITY_HUB_ISSUER: signIn.issuer,
          IDENTITY_HUB_CLIENT_ID: signIn.clientId,
          IDENTITY_HUB_CLIENT_SECRET: signIn.clientSecret,
        },
      }).pipe(adopt(true));
      return { url: site.siteUrl };
    }

    if (stage === "prod") {
      // "Push" pushes the code first, with the hub variables that production has, so the callback's
      // site serves the verification file before the client registers. Its one variable is
      // SCOUT_COMMIT, which "Site" also sets with the same value: it is in the push's hash, so every
      // commit pushes. adopt(true) takes over the production deployment, which has code. Retained
      // with Site.
      const push = yield* Convex.Deployment("Push", {
        project,
        type: "prod",
        rootDir: "apps/scout",
        env: { SCOUT_COMMIT: commit },
        source: { path: "./convex", command: ["node", "--run", "deploy"] },
      }).pipe(adopt(true), Alchemy.RemovalPolicy.retain());
      // The production client, on the fixed callback. The map on the push's output makes the client
      // wait for the push and does not change the address. A destroy leaves a production client on
      // the hub.
      const signIn = IdentityHub.Client.variables(
        yield* IdentityHub.Client("HubClient", {
          app: IDENTITY_HUB_APP,
          hub: HUB,
          connectors: ["google"],
          redirectUris: Output.map(push.siteUrl, () => [
            `${PRODUCTION_SITE_URL}${HUB_CALLBACK_PATH}`,
          ]),
          deploymentType: "production",
          softwareVersion: commit,
          required: true,
        }),
      );
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
      // "Site" writes the variables, with no push.
      yield* Convex.Deployment("Site", {
        project,
        type: "prod",
        rootDir: "apps/scout",
        env: {
          SCOUT_COMMIT: commit,
          SITE_URL: PRODUCTION_SITE_URL,
          IDENTITY_HUB_ISSUER: signIn.issuer,
          IDENTITY_HUB_CLIENT_ID: signIn.clientId,
          IDENTITY_HUB_CLIENT_SECRET: signIn.clientSecret,
          CLOUDFLARE_EMAIL_ACCOUNT_ID: accountId,
          CLOUDFLARE_EMAIL_API_TOKEN: emailToken.value,
        },
      }).pipe(adopt(true), Alchemy.RemovalPolicy.retain());
      return { url: PRODUCTION_SITE_URL };
    }

    // A preview's hub callback is on its own `.convex.site` URL, which exists only after Convex
    // creates the deployment. "Preview" creates the deployment and pushes: the push command also
    // sets SITE_URL to the preview's site and seeds the password account. Its first push has the
    // off values of the three hub variables, which ensure-convex-auth.ts sets when they are missing.
    // Then the client registers, and "Site" takes the same deployment over with adopt(true) and
    // writes the variables, with no push. Both delete it on destroy; the second delete finds it
    // gone. adopt(true) also takes over a preview with the name of this stage that an earlier run
    // created.
    const preview = yield* Convex.Deployment("Preview", {
      project,
      type: "preview",
      name: stage,
      rootDir: "apps/scout",
      // In the push's hash, so every commit pushes; "Site" sets the same value.
      env: { SCOUT_COMMIT: commit },
      source: { path: "./convex", command: ["node", "./scripts/deploy-preview.ts"] },
    }).pipe(adopt(true), Alchemy.RemovalPolicy.destroy());
    const signIn = IdentityHub.Client.variables(
      yield* IdentityHub.Client("HubClient", {
        app: IDENTITY_HUB_APP,
        hub: HUB,
        connectors: ["google"],
        redirectUris: [Output.interpolate`${preview.siteUrl}${HUB_CALLBACK_PATH}`],
        deploymentType: "preview",
        softwareVersion: commit,
        required: true,
      }),
    );
    const site = yield* Convex.Deployment("Site", {
      project,
      type: "preview",
      name: stage,
      rootDir: "apps/scout",
      env: {
        SCOUT_COMMIT: commit,
        IDENTITY_HUB_ISSUER: signIn.issuer,
        IDENTITY_HUB_CLIENT_ID: signIn.clientId,
        IDENTITY_HUB_CLIENT_SECRET: signIn.clientSecret,
      },
    }).pipe(adopt(true), Alchemy.RemovalPolicy.destroy());

    return { url: site.siteUrl };
  }),
);
