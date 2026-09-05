// Samebase starter dev launcher sha256:da7840e5d9ca9d8d2743a74709da6f36ef10078cf04c7585fee85840e044f35f
/// <reference types="node" />
import process from "node:process";

import { runPrimaryDev } from "./run-primary-dev.ts";

process.env["CONVEX_AGENT_MODE"] = "anonymous";
delete process.env["CONVEX_DEPLOY_KEY"];
process.env["SCOUT_LOCAL_WORKTREE_AUTH"] = "true";
process.env["VITE_LOCAL_WORKTREE_PASSWORD_EMAIL"] = "nicu.dev@gmail.com";
process.env["VITE_LOCAL_WORKTREE_PASSWORD_VALUE"] = "pass1234";
runPrimaryDev();
