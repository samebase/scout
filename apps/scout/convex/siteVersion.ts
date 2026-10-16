import { v } from "convex/values";
import { publicQuery } from "./functions";
import { versionId } from "../.convex-hosting/version.js";

export const get = publicQuery({
  access: "access_public",
  args: {},
  returns: v.string(),
  handler: () => versionId,
});
