import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const MAX_PRODUCTS = 200;
export const MAX_PRODUCT_NAME_LENGTH = 120;
export const MAX_PRODUCT_DOMAIN_LENGTH = 253;
export const MAX_PRODUCT_URL_INPUT_LENGTH = 2_048;

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function requiredProductText(value: string, label: string, maximumLength: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }
  if (trimmed.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer`);
  }
  return trimmed;
}

function parseDomainInput(value: string, label: string) {
  const input = requiredProductText(value, label, MAX_PRODUCT_URL_INPUT_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    throw new Error(`${label} must be a valid hostname or URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${label} must not include credentials`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  const validLabels = labels.every(
    (domainLabel) => domainLabel.length <= 63 && DNS_LABEL_PATTERN.test(domainLabel),
  );
  if (
    !hostname ||
    hostname.length > MAX_PRODUCT_DOMAIN_LENGTH ||
    labels.length < 2 ||
    IPV4_PATTERN.test(hostname) ||
    !validLabels
  ) {
    throw new Error(`${label} must be a valid hostname or URL`);
  }
  return { hostname, parsed };
}

export function canonicalProductDomain(value: string, label = "Product URL") {
  const { hostname: parsedHostname } = parseDomainInput(value, label);
  return parsedHostname.startsWith("www.") && parsedHostname.split(".").length > 2
    ? parsedHostname.slice(4)
    : parsedHostname;
}

export function canonicalCredentialHost(value: string, label = "Login host") {
  const { hostname, parsed } = parseDomainInput(value, label);
  if (
    parsed.protocol !== "https:" ||
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`${label} must be an HTTPS hostname without a path, port, query, or fragment`);
  }
  return hostname;
}

export function primaryProductUrl(domain: string) {
  return `https://${domain}`;
}

export function inferredProductName(domain: string) {
  const labels = domain.split(".");
  const candidate = labels[0] === "www" && labels.length > 2 ? labels[1] : labels[0];
  const words = (candidate ?? domain).split("-").filter(Boolean);
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

export async function ensureProduct(
  ctx: Pick<MutationCtx, "db">,
  args: { name: string; domain: string },
): Promise<{ productId: Id<"products">; created: boolean }> {
  const domain = canonicalProductDomain(args.domain);
  const existing = await ctx.db
    .query("products")
    .withIndex("by_domain", (q) => q.eq("domain", domain))
    .unique();
  if (existing) {
    return { productId: existing._id, created: false };
  }

  const products = await ctx.db.query("products").withIndex("by_domain").take(MAX_PRODUCTS);
  if (products.length >= MAX_PRODUCTS) {
    throw new Error(`Product registry can contain at most ${MAX_PRODUCTS} products`);
  }
  const name = requiredProductText(args.name, "Product name", MAX_PRODUCT_NAME_LENGTH);
  return {
    productId: await ctx.db.insert("products", {
      name,
      domain,
      primaryUrl: primaryProductUrl(domain),
    }),
    created: true,
  };
}
