"use node";

import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { taskHumanHandoffPageValidator } from "./taskHumanHandoffsModel";
import { findActiveBrowserSession } from "./scout/lib/firecrawl";
import {
  hashHumanHandoffAccessToken,
  isHumanHandoffAccessToken,
} from "./scout/lib/humanHandoffAccess";

const accessArgs = {
  handoffId: v.string(),
  accessToken: v.optional(v.string()),
};

type HandoffPage = Infer<typeof taskHumanHandoffPageValidator>;

function tokenHash(accessToken: string | undefined) {
  if (accessToken === undefined) return undefined;
  return isHumanHandoffAccessToken(accessToken) ? hashHumanHandoffAccessToken(accessToken) : null;
}

export const load = action({
  args: accessArgs,
  returns: taskHumanHandoffPageValidator,
  handler: async (ctx, args): Promise<HandoffPage> => {
    const hash = tokenHash(args.accessToken);
    if (hash === null) return { status: "invalid" };
    const access = {
      handoffId: args.handoffId,
      ...(hash === undefined ? {} : { accessTokenHash: hash }),
    };
    const prepare = async () =>
      await ctx.runQuery(internal.taskHumanHandoffs.prepareAccess, {
        ...access,
        now: Date.now(),
      });
    let prepared = await prepare();
    if (prepared.status === "due") {
      await ctx.runMutation(internal.taskHumanHandoffs.expire, {
        handoffId: prepared.handoffId,
      });
      prepared = await prepare();
    }
    if (prepared.status === "due") return { status: "invalid" };
    if (prepared.status === "broken") {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, {
        ...access,
      });
    }
    if (prepared.status !== "waiting") return prepared;

    let activeSession;
    try {
      activeSession = await findActiveBrowserSession(prepared.providerSessionId);
    } catch {
      throw new Error("Scout could not verify the live browser. Try again.");
    }
    if (activeSession === null) {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, {
        ...access,
      });
    }
    if (activeSession.interactiveLiveViewUrl === null) {
      throw new Error("Scout could not verify the interactive browser. Try again.");
    }

    prepared = await prepare();
    if (prepared.status === "due") {
      await ctx.runMutation(internal.taskHumanHandoffs.expire, {
        handoffId: prepared.handoffId,
      });
      prepared = await prepare();
    }
    if (prepared.status === "due") return { status: "invalid" };
    if (prepared.status === "broken") {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, {
        ...access,
      });
    }
    if (prepared.status !== "waiting") return prepared;
    if (prepared.providerSessionId !== activeSession.sessionId) {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, {
        ...access,
      });
    }
    return {
      status: "waiting",
      handoffId: prepared.handoffId,
      reason: prepared.reason,
      scoutName: prepared.scoutName,
      ...(prepared.destination === undefined ? {} : { destination: prepared.destination }),
      expiresAt: prepared.expiresAt,
      serverNow: Date.now(),
      interactiveLiveViewUrl: activeSession.interactiveLiveViewUrl,
    };
  },
});

export const continueHandoff = action({
  args: accessArgs,
  returns: taskHumanHandoffPageValidator,
  handler: async (ctx, args): Promise<HandoffPage> => {
    const hash = tokenHash(args.accessToken);
    if (hash === null) return { status: "invalid" };
    const access = {
      handoffId: args.handoffId,
      ...(hash === undefined ? {} : { accessTokenHash: hash }),
    };
    const prepared = await ctx.runQuery(internal.taskHumanHandoffs.prepareAccess, {
      ...access,
      now: Date.now(),
    });
    if (prepared.status === "due") {
      await ctx.runMutation(internal.taskHumanHandoffs.expire, {
        handoffId: prepared.handoffId,
      });
      return await ctx.runMutation(internal.taskHumanHandoffs.continueAuthorized, {
        ...access,
      });
    }
    if (prepared.status === "broken") {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, {
        ...access,
      });
    }
    if (prepared.status !== "waiting") return prepared;

    let activeSession;
    try {
      activeSession = await findActiveBrowserSession(prepared.providerSessionId);
    } catch {
      throw new Error("Scout could not verify the live browser. Try again.");
    }
    if (
      activeSession === null ||
      activeSession.sessionId !== prepared.providerSessionId ||
      activeSession.interactiveLiveViewUrl === null
    ) {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, {
        ...access,
      });
    }
    return await ctx.runMutation(internal.taskHumanHandoffs.continueAuthorized, {
      ...access,
    });
  },
});
