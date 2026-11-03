export type JwtClaims = {
  sub?: string
  email?: string
  aal?: 'aal1' | 'aal2'
  amr?: { method: string; timestamp: number }[]
  client_id?: string
  exp?: number
}

export function decodeAccessTokenClaims(token: string): JwtClaims | null {
  try {
    const payloadB64 = token.split('.')[1]
    if (!payloadB64) return null
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8')
    return JSON.parse(json) as JwtClaims
  } catch {
    return null
  }
}
