import { v } from "convex/values";
import { playContextValidator } from "./play";

export const productKindValidator = v.union(v.literal("play"), v.literal("review"));

export const chatPurposeValidator = v.union(
  v.object({ kind: v.literal("general") }),
  playContextValidator.extend({ kind: v.literal("play") }),
  v.object({ kind: v.literal("review") }),
);

export const chatVisibilityValidator = v.union(v.literal("private"), v.literal("public"));

export const chatRuntimeValidator = v.union(
  v.object({ kind: v.literal("convex_agent") }),
  v.object({ kind: v.literal("agents_api"), sessionId: v.id("agentsApiSessions") }),
);
