import type { env } from "./_generated/server";

type PolarRuntimeEnv =
  | "POLAR_ACCESS_TOKEN"
  | "POLAR_WEBHOOK_SECRET"
  | "POLAR_SERVER"
  | "POLAR_ORGANIZATION_ID"
  | "POLAR_CREDIT_PRODUCT_ID"
  | "POLAR_CHECKOUT_ENABLED";

// Convex replaces process.env for each Node invocation. The generated env export
// captures the old object when a shared module is cached, so read it at call time.
export function getRuntimeEnv(name: keyof typeof env | PolarRuntimeEnv) {
  return process.env[name];
}
