export function normalizeAuthEmail(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Missing email");
  }

  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@")) {
    throw new Error("Invalid email");
  }
  return email;
}

export async function authEmailRateLimitKey(providerId: string, email: string) {
  const input = new TextEncoder().encode(`${providerId}:${email}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
