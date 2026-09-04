const ACCESS_TOKEN_PATTERN = /^hh1_[A-Za-z0-9_-]{43}$/;

export function isHumanHandoffAccessToken(value: string) {
  return ACCESS_TOKEN_PATTERN.test(value);
}

export function humanHandoffOrigin(value: string | undefined) {
  if (value === undefined) {
    throw new Error("SITE_URL is required to create a human handoff");
  }
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
    throw new Error("SITE_URL must be a secure application origin");
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
