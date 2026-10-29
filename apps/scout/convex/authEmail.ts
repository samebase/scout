import { ConvexError } from "convex/values";

/**
The form in which `users.email` stores an address: trimmed, lowercase, and NFC, the normalization of
the Convex Auth email component, so a lookup in either one finds the same address.
*/
export function normalizeAuthEmail(value: string) {
  const email = value.trim().toLowerCase().normalize("NFC");
  if (!email || email.length > 320 || !email.includes("@")) {
    throw new ConvexError("Enter a valid email address.");
  }
  return email;
}
