import { v } from "convex/values";

export const humanHandoffDeliveryArgsValidator = v.object({
  handoffId: v.id("scoutHumanHandoffs"),
});

export const humanHandoffDeliveryRecordValidator = v.object({
  handoffId: v.id("scoutHumanHandoffs"),
  inboxId: v.string(),
  recipientEmail: v.string(),
  scoutName: v.string(),
});
