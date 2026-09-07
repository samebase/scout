/* oxlint-disable no-restricted-imports -- This module is the public Convex authorization boundary. */
import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
  type CustomBuilder,
} from "convex-helpers/server/customFunctions";
import { internal } from "./_generated/api";
import {
  action as baseAction,
  mutation as baseMutation,
  query as baseQuery,
  type QueryCtx,
  type MutationCtx,
  type ActionCtx,
} from "./_generated/server";
import {
  requirePermission,
  requireViewerPermission,
  resolveViewer,
  type ViewerAccess,
} from "./access";
import type { AccountAccessKey } from "../shared/accessModel";
import type { DataModel } from "./_generated/dataModel";

type Empty = Record<string, never>;
type ProtectedContext = { viewer: ReturnType<typeof requireViewerPermission> };
type AccountPolicy = { access: AccountAccessKey };
type PublicPolicy = { access: "access_public" };

export const query = customQuery<
  Empty,
  ProtectedContext,
  Empty,
  "public",
  // @ts-expect-error Convex Auth optional fields include undefined; Convex helpers' GenericDocument excludes it under exactOptionalPropertyTypes. Persisted documents omit absent fields.
  DataModel,
  AccountPolicy
>(
  baseQuery,
  customCtx(async (ctx: QueryCtx, policy: AccountPolicy) => ({
    viewer: await requirePermission(ctx, policy.access),
  })),
);

export const mutation = customMutation<
  Empty,
  ProtectedContext,
  Empty,
  "public",
  // @ts-expect-error Convex Auth optional fields include undefined; Convex helpers' GenericDocument excludes it under exactOptionalPropertyTypes. Persisted documents omit absent fields.
  DataModel,
  AccountPolicy
>(
  baseMutation,
  customCtx(async (ctx: MutationCtx, policy: AccountPolicy) => ({
    viewer: await requirePermission(ctx, policy.access),
  })),
);

export const action: CustomBuilder<
  "action",
  Empty,
  ProtectedContext,
  Empty,
  ActionCtx,
  "public",
  AccountPolicy
> = customAction<
  Empty,
  ProtectedContext,
  Empty,
  "public",
  // @ts-expect-error Convex Auth optional fields include undefined; Convex helpers' GenericDocument excludes it under exactOptionalPropertyTypes. Persisted documents omit absent fields.
  DataModel,
  AccountPolicy
>(
  baseAction,
  customCtx(async (ctx: ActionCtx, policy: AccountPolicy) => {
    const viewer: ViewerAccess = await ctx.runQuery(internal.accounts.viewerForAction, {});
    return { viewer: requireViewerPermission(viewer, policy.access) };
  }),
);

export const publicQuery = customQuery<
  Empty,
  { viewer: ViewerAccess },
  Empty,
  "public",
  // @ts-expect-error Convex Auth optional fields include undefined; Convex helpers' GenericDocument excludes it under exactOptionalPropertyTypes. Persisted documents omit absent fields.
  DataModel,
  PublicPolicy
>(
  baseQuery,
  customCtx(async (ctx: QueryCtx, policy: PublicPolicy) => {
    if (policy.access !== "access_public") throw new Error("Declare a public access policy");
    return { viewer: await resolveViewer(ctx) };
  }),
);

export const publicMutation = customMutation<
  Empty,
  { viewer: ViewerAccess },
  Empty,
  "public",
  // @ts-expect-error Convex Auth optional fields include undefined; Convex helpers' GenericDocument excludes it under exactOptionalPropertyTypes. Persisted documents omit absent fields.
  DataModel,
  PublicPolicy
>(
  baseMutation,
  customCtx(async (ctx: MutationCtx, policy: PublicPolicy) => {
    if (policy.access !== "access_public") throw new Error("Declare a public access policy");
    return { viewer: await resolveViewer(ctx) };
  }),
);

export const publicAction = customAction<
  Empty,
  Record<never, never>,
  Empty,
  "public",
  // @ts-expect-error Convex Auth optional fields include undefined; Convex helpers' GenericDocument excludes it under exactOptionalPropertyTypes. Persisted documents omit absent fields.
  DataModel,
  PublicPolicy
>(
  baseAction,
  customCtx((_ctx: ActionCtx, policy: PublicPolicy) => {
    if (policy.access !== "access_public") throw new Error("Declare a public access policy");
    return {};
  }),
);
