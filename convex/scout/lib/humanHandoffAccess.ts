"use node";

import { createHash, randomBytes } from "node:crypto";

const ACCESS_TOKEN_PATTERN = /^hh1_[A-Za-z0-9_-]{43}$/;

export function createHumanHandoffAccessToken() {
  return `hh1_${randomBytes(32).toString("base64url")}`;
}

export function isHumanHandoffAccessToken(value: string) {
  return ACCESS_TOKEN_PATTERN.test(value);
}

export function hashHumanHandoffAccessToken(value: string) {
  if (!isHumanHandoffAccessToken(value)) {
    throw new Error("Human handoff access token is invalid");
  }
  return createHash("sha256").update(value).digest("hex");
}

export function humanHandoffOrigin(value: string) {
  const parsed = new URL(value);
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("SCOUT_PUBLIC_APP_URL must be a secure public origin");
  }
  return parsed.origin;
}

export function humanHandoffUrl(origin: string, handoffId: string, accessToken: string) {
  if (!isHumanHandoffAccessToken(accessToken)) {
    throw new Error("Human handoff access token is invalid");
  }
  const url = new URL(`/handoff/${encodeURIComponent(handoffId)}`, humanHandoffOrigin(origin));
  url.hash = new URLSearchParams({ access: accessToken }).toString();
  return url.toString();
}
