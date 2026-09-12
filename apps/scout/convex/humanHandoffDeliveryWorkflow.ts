import { v } from "convex/values";
import { internal } from "./_generated/api";
import { humanHandoffDeliveryArgsValidator } from "./humanHandoffDeliveryModel";
import { humanHandoffWorkflow } from "./humanHandoffWorkflow";

export const deliverEmail = humanHandoffWorkflow
  .define({
    args: humanHandoffDeliveryArgsValidator.fields,
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const result = await step.runAction(internal.humanHandoffDelivery.send, args);
    if (result.kind === "definitive_failure") {
      await step.runMutation(internal.humanHandoffs.failDelivery, {
        handoffId: args.handoffId,
      });
    }
    return null;
  });
