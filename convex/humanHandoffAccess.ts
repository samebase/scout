"use node";

import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { humanHandoffPageValidator } from "./humanHandoffsModel";
import { omitNullish } from "../shared/omitNullish";
import { requireFirecrawlLiveViewUrl } from "./scout/lib/firecrawlLiveView";
import {
  hashHumanHandoffAccessToken,
  isHumanHandoffAccessToken,
} from "./scout/lib/humanHandoffAccess";

const accessArgs = {
  handoffId: v.string(),
  accessToken: v.optional(v.string()),
};

type HandoffPage = Infer<typeof humanHandoffPageValidator>;

function tokenHash(accessToken: string | undefined) {
  if (accessToken === undefined) return undefined;
  return isHumanHandoffAccessToken(accessToken) ? hashHumanHandoffAccessToken(accessToken) : null;
}

function accessInput(args: { handoffId: string; accessToken?: string }) {
  const hash = tokenHash(args.accessToken);
  return hash === null
    ? null
    : {
        handoffId: args.handoffId,
        ...omitNullish({ accessTokenHash: hash }),
      };
}

export const load = action({
  args: accessArgs,
  returns: humanHandoffPageValidator,
  handler: async (ctx, args): Promise<HandoffPage> => {
    const access = accessInput(args);
    if (!access) return { status: "invalid" };
    const prepare = async () =>
      await ctx.runQuery(internal.humanHandoffs.prepareAccess, {
        ...access,
        now: Date.now(),
      });
    let prepared = await prepare();
    if (prepared.status === "due") {
      await ctx.runMutation(internal.humanHandoffs.expire, {
        handoffId: prepared.handoffId,
      });
      prepared = await prepare();
    }
    if (prepared.status === "due") return { status: "invalid" };
    if (prepared.status === "broken") {
      return await ctx.runMutation(internal.humanHandoffs.failAccess, access);
    }
    if (prepared.status !== "available" && prepared.status !== "active") return prepared;

    let liveViewUrl = requireFirecrawlLiveViewUrl(prepared.interactiveLiveViewUrl);

    if (prepared.status === "available") {
      prepared = await ctx.runMutation(internal.humanHandoffs.claimAuthorized, access);
      if (prepared.status === "due") {
        await ctx.runMutation(internal.humanHandoffs.expire, {
          handoffId: prepared.handoffId,
        });
        prepared = await prepare();
      }
      if (prepared.status === "broken") {
        return await ctx.runMutation(internal.humanHandoffs.failAccess, access);
      }
      if (
        prepared.status === "invalid" ||
        prepared.status === "continued" ||
        prepared.status === "expired" ||
        prepared.status === "failed"
      ) {
        return prepared;
      }
      if (prepared.status !== "active") return { status: "invalid" };
    }

    liveViewUrl = requireFirecrawlLiveViewUrl(prepared.interactiveLiveViewUrl);
    return {
      status: "waiting",
      handoffId: prepared.handoffId,
      reason: prepared.reason,
      scoutName: prepared.scoutName,
      ...omitNullish({ destination: prepared.destination }),
      expiresAt: prepared.expiresAt,
      serverNow: Date.now(),
      interactiveLiveViewUrl: liveViewUrl,
    };
  },
});

export const continueHandoff = action({
  args: accessArgs,
  returns: humanHandoffPageValidator,
  handler: async (ctx, args): Promise<HandoffPage> => {
    const access = accessInput(args);
    if (!access) return { status: "invalid" };
    let prepared = await ctx.runQuery(internal.humanHandoffs.prepareAccess, {
      ...access,
      now: Date.now(),
    });
    if (prepared.status === "due") {
      await ctx.runMutation(internal.humanHandoffs.expire, {
        handoffId: prepared.handoffId,
      });
      return await ctx.runMutation(internal.humanHandoffs.continueAuthorized, access);
    }
    if (prepared.status === "broken") {
      return await ctx.runMutation(internal.humanHandoffs.failAccess, access);
    }
    if (prepared.status !== "available" && prepared.status !== "active") return prepared;

    requireFirecrawlLiveViewUrl(prepared.interactiveLiveViewUrl);
    if (prepared.status === "available") {
      prepared = await ctx.runMutation(internal.humanHandoffs.claimAuthorized, access);
      if (prepared.status === "broken") {
        return await ctx.runMutation(internal.humanHandoffs.failAccess, access);
      }
      if (prepared.status === "due") {
        await ctx.runMutation(internal.humanHandoffs.expire, {
          handoffId: prepared.handoffId,
        });
        return await ctx.runMutation(internal.humanHandoffs.continueAuthorized, access);
      }
      if (
        prepared.status === "invalid" ||
        prepared.status === "continued" ||
        prepared.status === "expired" ||
        prepared.status === "failed"
      ) {
        return prepared;
      }
      if (prepared.status !== "active") return { status: "invalid" };
    }
    return await ctx.runMutation(internal.humanHandoffs.continueAuthorized, access);
  },
});
