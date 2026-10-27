/**
 * Make one path segment safe for a Supabase Storage object key.
 *
 * Storage rejects keys containing characters such as `[` `]` with
 * "Invalid key". Field ids inside a repeating group look like
 * `sub_feeds[0].breaker_size`, and user file names can carry anything, so
 * every segment that comes from data (not a uuid we minted) must pass through
 * here. The database row keeps the real id — only the storage path is
 * flattened.
 */
export function storageKeySegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, '_')
  return safe.length > 0 ? safe : '_'
}
