import type { env } from "./_generated/server";

// Convex replaces process.env for each Node invocation. The generated env export
// captures the old object when a shared module is cached, so read it at call time.
export function getRuntimeEnv(name: keyof typeof env) {
  return process.env[name];
}
