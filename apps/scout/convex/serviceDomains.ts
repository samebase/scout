const MAX_SERVICE_DOMAIN_LENGTH = 253;
const MAX_SERVICE_URL_INPUT_LENGTH = 2_048;

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function requiredDomainInput(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }
  if (trimmed.length > MAX_SERVICE_URL_INPUT_LENGTH) {
    throw new Error(`${label} must be ${MAX_SERVICE_URL_INPUT_LENGTH} characters or fewer`);
  }
  return trimmed;
}

function parseDomainInput(value: string, label: string) {
  const input = requiredDomainInput(value, label);
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
    hostname.length > MAX_SERVICE_DOMAIN_LENGTH ||
    labels.length < 2 ||
    IPV4_PATTERN.test(hostname) ||
    !validLabels
  ) {
    throw new Error(`${label} must be a valid hostname or URL`);
  }
  return { hostname, parsed };
}

export function canonicalServiceDomain(value: string, label = "Service domain") {
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
