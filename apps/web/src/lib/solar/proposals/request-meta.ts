/** Server-stamped request evidence (spec §9.4): never taken from the request body. */
export function clientIp(h: Headers): string | null {
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = fwd || h.get('x-real-ip')?.trim() || null
  return ip ? ip.slice(0, 64) : null
}
export function userAgent(h: Headers): string | null {
  const ua = h.get('user-agent')
  return ua ? ua.slice(0, 512) : null
}
