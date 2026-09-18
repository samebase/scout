import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { expiredHandoff, handoffDeadline, humanHandoffValidator } from "./humanHandoffsModel";

// Existing handoff expiry jobs must still release their browser after Lab retirement.
export const expire = internalMutation({
  args: { handoffId: v.id("scoutHumanHandoffs") },
  returns: v.union(
    v.literal("missing"),
    ...humanHandoffValidator.members.map((member) => member.fields.status),
  ),
  handler: async (ctx, { handoffId }) => {
    const handoff = await ctx.db.get(handoffId);
    if (!handoff) return "missing";
    if (handoff.status !== "available" && handoff.status !== "active") return handoff.status;
    const now = Date.now();
    if (now < handoffDeadline(handoff)) return handoff.status;
    await ctx.db.replace(handoffId, expiredHandoff(handoff, now));
    const browser = await ctx.db.get(handoff.sessionId);
    if (browser && browser.lifecycle.kind !== "closed") {
      await ctx.db.patch(browser._id, {
        lifecycle: { ...browser.lifecycle, kind: "closing", closingAtMs: now },
      });
      await ctx.scheduler.runAfter(0, internal.humanHandoffBrowser.finishBrowserSession, {
        sessionId: browser._id,
        usageTurnId: handoff.turnId,
        captureEvidence: false,
      });
    }
    return "expired";
  },
});
