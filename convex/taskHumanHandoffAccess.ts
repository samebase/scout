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

function accessInput(args: { handoffId: string; accessToken?: string }) {
  const hash = tokenHash(args.accessToken);
  return hash === null
    ? null
    : {
        handoffId: args.handoffId,
        ...(hash === undefined ? {} : { accessTokenHash: hash }),
      };
}

async function verifiedSession(
  providerSessionId: string,
): Promise<{ sessionId: string; interactiveLiveViewUrl: string } | null> {
  try {
    const session = await findActiveBrowserSession(providerSessionId);
    return session?.interactiveLiveViewUrl
      ? {
          sessionId: session.sessionId,
          interactiveLiveViewUrl: session.interactiveLiveViewUrl,
        }
      : null;
  } catch {
    throw new Error("Scout could not verify the live browser. Try again.");
  }
}

export const load = action({
  args: accessArgs,
  returns: taskHumanHandoffPageValidator,
  handler: async (ctx, args): Promise<HandoffPage> => {
    const access = accessInput(args);
    if (!access) return { status: "invalid" };
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
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, access);
    }
    if (prepared.status !== "available" && prepared.status !== "active") return prepared;

    let activeSession = await verifiedSession(prepared.providerSessionId);
    if (!activeSession) {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, access);
    }

    if (prepared.status === "available") {
      prepared = await ctx.runMutation(internal.taskHumanHandoffs.claimAuthorized, access);
      if (prepared.status === "due") {
        await ctx.runMutation(internal.taskHumanHandoffs.expire, {
          handoffId: prepared.handoffId,
        });
        prepared = await prepare();
      }
      if (prepared.status === "broken") {
        return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, access);
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

    if (prepared.providerSessionId !== activeSession.sessionId) {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, access);
    }
    activeSession = await verifiedSession(prepared.providerSessionId);
    if (!activeSession) {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, access);
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
    const access = accessInput(args);
    if (!access) return { status: "invalid" };
    let prepared = await ctx.runQuery(internal.taskHumanHandoffs.prepareAccess, {
      ...access,
      now: Date.now(),
    });
    if (prepared.status === "due") {
      await ctx.runMutation(internal.taskHumanHandoffs.expire, {
        handoffId: prepared.handoffId,
      });
      return await ctx.runMutation(internal.taskHumanHandoffs.continueAuthorized, access);
    }
    if (prepared.status === "broken") {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, access);
    }
    if (prepared.status !== "available" && prepared.status !== "active") return prepared;

    const activeSession = await verifiedSession(prepared.providerSessionId);
    if (!activeSession || activeSession.sessionId !== prepared.providerSessionId) {
      return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, access);
    }
    if (prepared.status === "available") {
      prepared = await ctx.runMutation(internal.taskHumanHandoffs.claimAuthorized, access);
      if (prepared.status === "broken") {
        return await ctx.runMutation(internal.taskHumanHandoffs.failAccess, access);
      }
      if (prepared.status === "due") {
        await ctx.runMutation(internal.taskHumanHandoffs.expire, {
          handoffId: prepared.handoffId,
        });
        return await ctx.runMutation(internal.taskHumanHandoffs.continueAuthorized, access);
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
    return await ctx.runMutation(internal.taskHumanHandoffs.continueAuthorized, access);
  },
});
