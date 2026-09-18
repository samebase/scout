import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function failPendingModelCall(
  ctx: MutationCtx,
  turnId: Doc<"scoutTurns">["_id"],
  failure: string,
) {
  const pending = await ctx.db
    .query("scoutModelCalls")
    .withIndex("by_turn_id_and_sequence", (index) => index.eq("turnId", turnId))
    .order("desc")
    .first();
  if (pending?.state.kind === "pending") {
    await ctx.db.patch(pending._id, {
      state: { kind: "failed", failedAt: Date.now(), failure },
    });
  }
}
