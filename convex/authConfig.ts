export const ADMIN_ONLY = true;
export const ADMIN_EMAIL = "nicu.dev@gmail.com";

export function isAllowedAccountEmail(email: string) {
  return !ADMIN_ONLY || email === ADMIN_EMAIL;
}
