import { z } from "zod";
import { getRuntimeEnv } from "./runtimeEnv";

const configSchema = z.object({
  environment: z.enum(["sandbox", "production"]),
  accessToken: z.string().trim().min(1),
  organizationId: z.uuid(),
  productId: z.uuid(),
  siteUrl: z.url(),
});

export function polarConfig() {
  return configSchema.parse({
    environment: getRuntimeEnv("POLAR_SERVER"),
    accessToken: getRuntimeEnv("POLAR_ACCESS_TOKEN"),
    organizationId: getRuntimeEnv("POLAR_ORGANIZATION_ID"),
    productId: getRuntimeEnv("POLAR_CREDIT_PRODUCT_ID"),
    siteUrl: getRuntimeEnv("SITE_URL"),
  });
}

export function polarWebhookConfig() {
  return z
    .object({
      environment: z.enum(["sandbox", "production"]),
      webhookSecret: z.string().trim().min(1),
    })
    .parse({
      environment: getRuntimeEnv("POLAR_SERVER"),
      webhookSecret: getRuntimeEnv("POLAR_WEBHOOK_SECRET"),
    });
}

export function checkoutEnabled() {
  return getRuntimeEnv("POLAR_CHECKOUT_ENABLED") === "true";
}
