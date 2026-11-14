/** Resolves an injected clock (Date | number | ISO string | getter) to epoch seconds. */
export function toUnixSeconds(value) {
  const resolved = typeof value === "function" ? value() : value;

  if (resolved === null || resolved === undefined) return Math.floor(Date.now() / 1000);
  if (typeof resolved === "number") return Math.floor(resolved > 1e11 ? resolved / 1000 : resolved);
  if (resolved instanceof Date) return Math.floor(resolved.getTime() / 1000);

  const parsed = Date.parse(String(resolved));

  return Number.isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000);
}

export function isoNow(now) {
  return new Date(toUnixSeconds(now) * 1000).toISOString();
}
