import { execFileSync } from "node:child_process";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// Deployment hashing covers apps/scout. Include the commit so changes to workspace configuration
// and packages outside that directory also deploy.
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

export default Alchemy.Stack(
  "samebase/scout",
  {
    providers: Layer.mergeAll(Convex.providers(), GitHub.providers()),
    state: Convex.state({ team: "nicu" }),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    // A slug selects the existing project without creating, renaming, or deleting it.
    const project = yield* Convex.Project("Project", { team: "nicu", slug: "scout" }).pipe(
      adopt(true),
      Alchemy.RemovalPolicy.retain(),
    );

    const site = yield* (
      stage === "prod"
        ? Convex.Deployment("Site", {
            project,
            type: "prod",
            rootDir: "apps/scout",
            env: { SCOUT_COMMIT: commit },
            source: { path: "./convex", command: ["node", "--run", "deploy"] },
          }).pipe(Alchemy.RemovalPolicy.retain())
        : Convex.Deployment("Site", {
            project,
            type: "preview",
            name: stage,
            rootDir: "apps/scout",
            env: { SCOUT_COMMIT: commit },
            source: { path: "./convex", command: ["node", "./scripts/deploy-preview.ts"] },
          }).pipe(Alchemy.RemovalPolicy.destroy())
    ).pipe(adopt(true));

    const github = yield* GitHub.GitHubEnv;
    if (stage !== "prod" && github?.pr) {
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
