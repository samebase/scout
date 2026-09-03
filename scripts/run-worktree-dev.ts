// Samebase starter dev launcher sha256:41059bcd1300c5d589d2bcbc909c1cbad3c0593b6b3e5e3da6defbec2a688419
/// <reference types="node" />
import process from "node:process";

import { runPrimaryDev } from "./run-primary-dev.ts";

process.env["CONVEX_AGENT_MODE"] = "anonymous";
delete process.env["CONVEX_DEPLOY_KEY"];
process.env["SCOUT_LOCAL_WORKTREE_AUTH"] = "true";
process.env["VITE_LOCAL_WORKTREE_PASSWORD_EMAIL"] = "nicu@samebase.com";
process.env["VITE_LOCAL_WORKTREE_PASSWORD_VALUE"] = "pass1234";
runPrimaryDev();
