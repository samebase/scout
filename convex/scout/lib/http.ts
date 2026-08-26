const MAX_PROVIDER_ERROR_LENGTH = 1_000;

export function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export async function fetchJson(
  provider: string,
  input: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetch(input, init);
  const body = await response.text();

  if (!response.ok) {
    const detail = body.trim().slice(0, MAX_PROVIDER_ERROR_LENGTH);
    throw new Error(
      `${provider} request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${provider} returned invalid JSON`);
  }
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid response`);
  }
  return value as Record<string, unknown>;
}

export function requireString(record: Record<string, unknown>, field: string, label: string) {
  const value = record[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} response is missing ${field}`);
  }
  return value;
}
