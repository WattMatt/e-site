/** A status plan id is a uuid; anything else is "not found", never a database error (22P02 → 500). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isPlanId = (s: string): boolean => UUID_RE.test(s)
