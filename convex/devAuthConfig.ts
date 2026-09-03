import { env } from "./_generated/server";
import { normalizeAuthEmail } from "./authEmail";

type DevSeedAuthEnv = {
  CONVEX_CLOUD_URL?: string | undefined;
  CONVEX_DEPLOYMENT?: string | undefined;
  DEV_SEED_AUTH_EMAIL?: string | undefined;
  DEV_SEED_AUTH_ENABLED?: string | undefined;
  DEV_SEED_AUTH_PASSWORD?: string | undefined;
};

export type DevSeedPasswordAccountConfig =
  | { kind: "disabled" }
  | {
      kind: "enabled";
      email: string;
      password: string;
    };

function readTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isProductionDeployment(deployment: string | undefined): boolean {
  return readTrimmed(deployment)?.split(":", 1)[0]?.toLowerCase() === "prod";
}

export function resolveDevSeedPasswordAccountConfig(
  deploymentEnv: DevSeedAuthEnv,
): DevSeedPasswordAccountConfig {
  if (readTrimmed(deploymentEnv.DEV_SEED_AUTH_ENABLED)?.toLowerCase() !== "true") {
    return { kind: "disabled" };
  }
  if (isProductionDeployment(deploymentEnv.CONVEX_DEPLOYMENT)) {
    throw new Error("Development password account seeding is disabled in production");
  }
  const backendUrl = URL.parse(deploymentEnv.CONVEX_CLOUD_URL ?? "");
  if (
    backendUrl?.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(backendUrl.hostname)
  ) {
    throw new Error("Development password account seeding requires a local backend");
  }

  const email = readTrimmed(deploymentEnv.DEV_SEED_AUTH_EMAIL);
  const password = readTrimmed(deploymentEnv.DEV_SEED_AUTH_PASSWORD);
  if (!email || !password) {
    throw new Error(
      "DEV_SEED_AUTH_EMAIL and DEV_SEED_AUTH_PASSWORD are required when DEV_SEED_AUTH_ENABLED is true",
    );
  }

  return {
    kind: "enabled",
    email: normalizeAuthEmail(email),
    password,
  };
}

export function readDevSeedPasswordAccountConfig(): DevSeedPasswordAccountConfig {
  return resolveDevSeedPasswordAccountConfig({
    CONVEX_CLOUD_URL: env.CONVEX_CLOUD_URL,
    CONVEX_DEPLOYMENT: process.env["CONVEX_DEPLOYMENT"],
    DEV_SEED_AUTH_EMAIL: env.DEV_SEED_AUTH_EMAIL,
    DEV_SEED_AUTH_ENABLED: env.DEV_SEED_AUTH_ENABLED,
    DEV_SEED_AUTH_PASSWORD: env.DEV_SEED_AUTH_PASSWORD,
  });
}
