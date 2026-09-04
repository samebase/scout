export function omitNullish<const T extends Record<string, unknown>>(
  value: T,
): { [Key in keyof T]?: Exclude<T[Key], null | undefined> };
export function omitNullish(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null));
}
