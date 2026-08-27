import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { ADMIN_ONLY, isAllowedAccountEmail } from "./authConfig";
import { readDevSeedPasswordAccountConfig } from "./devAuthConfig";

type AuthenticatedDatabaseContext = Pick<QueryCtx, "auth" | "db">;

export async function getAppUserId(ctx: AuthenticatedDatabaseContext): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId || !ADMIN_ONLY) {
    return userId;
  }

  const user = await ctx.db.get(userId);
  const devSeedConfig = readDevSeedPasswordAccountConfig();
  const devSeedEmail = devSeedConfig.kind === "enabled" ? devSeedConfig.email : undefined;
  return user?.email && isAllowedAccountEmail(user.email, devSeedEmail) ? userId : null;
}

export async function requireAppUser(ctx: AuthenticatedDatabaseContext) {
  const userId = await getAppUserId(ctx);
  if (!userId) {
    throw new Error("Not authorized");
  }
  return userId;
}
