/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "convex-helpers/validators";
import { v } from "convex/values";
import { parse } from "dotenv";

// Registers the development deployment of this checkout as a client of the team's identity hub,
// once, and stores the client on it: HUB_ISSUER, HUB_CLIENT_ID, and HUB_CLIENT_SECRET, which
// convex/convex.config.ts requires. `pnpm run dev` and `pnpm run deploy:dev` run it before their
// push, next to scripts/ensure-convex-auth.ts.
//
// The root alchemy.run.ts registers production and every preview. This script covers the
// deployment that Alchemy does not deploy: the development deployment of apps/scout/.env.local,
// where the developer puts HUB_ISSUER and HUB_REGISTRATION_TOKEN once (docs/local-setup.md). A
// deployment that has a complete client of that issuer keeps it. The registration token stays in
// this process, and the client secret reaches the Convex CLI on standard input.
const CALLBACK_PATH = "/auth/hub/callback";
const convex = fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url));
const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
/** The hub's RFC 7591 answer to a registration, and its OAuth error answer. */
const registration = v.object({ client_id: v.string(), client_secret: v.string() });
const oauthError = v.object({ error: v.string() });

function runConvex(args: string[], input?: string) {
  return execFileSync(process.execPath, [convex, ...args], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  }).trim();
}

/** A variable of the deployment, or "" when it has none. */
function readVariable(name: string) {
  return execFileSync(process.execPath, [convex, "env", "get", name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const local = existsSync(envFile) ? parse(readFileSync(envFile, "utf8")) : {};
const issuer = local["HUB_ISSUER"]?.replace(/\/$/, "") || undefined;
const token = local["HUB_REGISTRATION_TOKEN"] || undefined;
// A header cannot carry a control character or a space, and the error that fetch would throw
// prints the whole header.
if (token !== undefined && !/^[!-~]+$/.test(token))
  throw new Error(
    "HUB_REGISTRATION_TOKEN in apps/scout/.env.local has a character that a header cannot carry. Paste the token again.",
  );

const storedIssuer = readVariable("HUB_ISSUER");
const storedClientId = readVariable("HUB_CLIENT_ID");
const storedClientSecret = readVariable("HUB_CLIENT_SECRET");
if (
  storedIssuer !== "" &&
  storedClientId !== "" &&
  storedClientSecret !== "" &&
  (issuer === undefined || storedIssuer === issuer)
) {
  console.log("Hub client already registered.");
} else {
  if (issuer === undefined || token === undefined) {
    throw new Error(
      "The development deployment has no complete hub client. Set HUB_ISSUER and HUB_REGISTRATION_TOKEN in apps/scout/.env.local (docs/local-setup.md).",
    );
  }
  const siteUrl: unknown = JSON.parse(
    runConvex(["run", "--inline-query", "process.env.CONVEX_SITE_URL"]),
  );
  if (typeof siteUrl !== "string") {
    throw new Error("The development deployment has no CONVEX_SITE_URL.");
  }
  const callbackUrl = `${siteUrl.replace(/\/$/, "")}${CALLBACK_PATH}`;

  const response = await fetch(`${issuer}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [callbackUrl],
      client_name: "development",
      software_version: new URL(siteUrl).host,
      deployment_type: "development",
      // Convex Auth posts the client credentials in the token request body.
      token_endpoint_auth_method: "client_secret_post",
    }),
  });
  const body: unknown = await response.json();
  if (response.status !== 201 || !validate(registration, body, { allowUnknownFields: true })) {
    // The hub's OAuth error code only, never its description.
    const code = validate(oauthError, body, { allowUnknownFields: true }) ? body.error : "";
    throw new Error(`Hub registration failed with ${response.status}: ${code}`.trim());
  }
  // One request on standard input, so the secret stays out of the process arguments. `--force`
  // replaces the values of an earlier client.
  runConvex(
    ["env", "set", "--force"],
    `HUB_ISSUER='${issuer}'\nHUB_CLIENT_ID='${body.client_id}'\nHUB_CLIENT_SECRET='${body.client_secret}'\n`,
  );
  console.log(`Hub client registered for ${callbackUrl}.`);
}
