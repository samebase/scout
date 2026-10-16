import { v } from "convex/values";
import { versionId } from "../.convex-hosting/version.js";
// oxlint-disable-next-line no-restricted-imports -- Protocol boundary: the site version is public and has no viewer.
import { query } from "./_generated/server";

export const get = query({
  args: {},
  returns: v.string(),
  handler: () => versionId,
});
