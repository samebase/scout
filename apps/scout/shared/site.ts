import { z } from "zod";

export const siteHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    "Use the site's exact hostname, such as samebase.com, without a URL path or port",
  );

export const siteSearchSchema = z.string().trim().toLowerCase();
