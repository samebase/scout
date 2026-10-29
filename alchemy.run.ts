import { execFileSync } from "node:child_process";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Convex from "@samebase/alchemy-convex";
import * as IdentityHub from "@samebase/alchemy-identity-hub";
import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

// Deployment hashing covers apps/scout. Include the commit so changes to workspace configuration
// and packages outside that directory also deploy.
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

/**
The site of production. TrailScout has no custom domain: production serves on its deployment's own
`.convex.site` URL, its CONVEX_SITE_URL and SITE_URL, where Convex Auth builds the hub callback.
*/
const PRODUCTION_SITE_URL = "https://doting-crab-687.convex.site";
/** The identity hub's callback into Convex Auth, after CONVEX_SITE_URL (convex/convex.config.ts). */
const HUB_CALLBACK_PATH = "/auth/hub/callback";

export default Alchemy.Stack(
  "samebase/scout",
  {
    providers: Layer.mergeAll(
      Convex.providers(),
      Cloudflare.providers(),
      GitHub.providers(),
      IdentityHub.providers(),
    ),
    state: Convex.state({ team: "nicu" }),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    // Each deployment is a client of the team's identity hub, for Google sign-in. Read before any
    // resource, a destroy too: alchemy.yml passes the repository variable HUB_ISSUER and the
    // repository secret HUB_REGISTRATION_TOKEN, and an empty value fails like a missing one.
    const hub = {
      issuer: yield* Config.NonEmptyString("HUB_ISSUER"),
      registrationToken: Redacted.make(yield* Config.NonEmptyString("HUB_REGISTRATION_TOKEN")),
      clientName: stage,
      softwareVersion: commit,
    };

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
    const project = yield* Convex.Project("Project", { team: "nicu", slug: "scout" }).pipe(
      adopt(true),
      Alchemy.RemovalPolicy.retain(),
    );

    if (stage === "prod") {
      // IdentityHub.Client registers the callback once, and `env` writes the client before the
      // push, which fails without it. Retained with Site: a destroy of this stage must not
      // unregister the client that production signs in with.
      const client = yield* IdentityHub.Client("HubClient", {
        ...hub,
        redirectUri: `${PRODUCTION_SITE_URL}${HUB_CALLBACK_PATH}`,
        deploymentType: "production",
      }).pipe(Alchemy.RemovalPolicy.retain());
      const site = yield* Convex.Deployment("Site", {
        project,
        type: "prod",
        rootDir: "apps/scout",
        env: {
          SCOUT_COMMIT: commit,
          HUB_ISSUER: client.issuer,
          HUB_CLIENT_ID: client.clientId,
          HUB_CLIENT_SECRET: client.clientSecret,
        },
        source: { path: "./convex", command: ["node", "--run", "deploy"] },
      }).pipe(adopt(true), Alchemy.RemovalPolicy.retain());
      return { url: site.siteUrl };
    }

    // A preview's hub callback is on its own `.convex.site` URL, which exists only after Convex
    // creates the deployment, and its push needs the client in `env`. A Convex.Deployment cannot
    // take an env value from its own outputs, so "Preview" creates the deployment, the client
    // registers its URL, and "Site" takes the same deployment over with adopt(true), writes the
    // variables, and pushes. Both delete it on destroy; the second delete finds it gone. adopt(true)
    // also takes over a preview with the name of this stage that an earlier run created.
    const preview = yield* Convex.Deployment("Preview", {
      project,
      type: "preview",
      name: stage,
    }).pipe(adopt(true), Alchemy.RemovalPolicy.destroy());
    const client = yield* IdentityHub.Client("HubClient", {
      ...hub,
      redirectUri: Output.map(preview.siteUrl, (siteUrl) => `${siteUrl}${HUB_CALLBACK_PATH}`),
      deploymentType: "preview",
    });
    const site = yield* Convex.Deployment("Site", {
      project,
      type: "preview",
      name: stage,
      rootDir: "apps/scout",
      env: {
        SCOUT_COMMIT: commit,
        HUB_ISSUER: client.issuer,
        HUB_CLIENT_ID: client.clientId,
        HUB_CLIENT_SECRET: client.clientSecret,
      },
      source: { path: "./convex", command: ["node", "./scripts/deploy-preview.ts"] },
    }).pipe(adopt(true), Alchemy.RemovalPolicy.destroy());

    const github = yield* GitHub.GitHubEnv;
    if (github?.pr) {
      yield* GitHub.Comment("PreviewComment", {
        owner: github.owner,
        repository: github.repository,
        issueNumber: github.pr,
        body: Output.interpolate`Preview \`${stage}\`: ${site.siteUrl}
Deployment: ${site.url}
Dashboard: https://dashboard.convex.dev/d/${site.name}`,
      }).pipe(Alchemy.RemovalPolicy.retain());
    }

    return { url: site.siteUrl };
  }),
);
