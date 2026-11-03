import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { OrgRole } from '@esite/shared'
import { decodeAccessTokenClaims } from '@/lib/supabase/jwt'
import { hasVerifiedMfaFactor } from '@/lib/auth/has-verified-mfa-factor'
import type { BearerContext } from '@/lib/supabase/request-auth'

export const CONNECT_REFUSAL = 'Claude access is for E-Site team members; ask your project owner.'
export const AAL_REFUSAL = 'Finish the two-factor check in the browser, then reconnect.'

export type McpAuthResult =
  | { ok: true; ctx: BearerContext; memberships: { organisationId: string; role: OrgRole }[] }
  | { ok: false; status: 401 | 403; sentence: string }

const UNAUTHENTICATED = 'Sign in required.'
const unauthorised = (): McpAuthResult => ({ ok: false, status: 401, sentence: UNAUTHENTICATED })

// The connect rule lives here and nowhere else: every active org member except
// client_viewer may use the server; an account with no membership (a tender-only
// account) never may. It runs on every request, so a user removed from their
// orgs after consent is refused on the next call, not only at consent.
export async function authenticateMcpRequest(request: Request): Promise<McpAuthResult> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!match) return unauthorised()
  const accessToken = match[1]

  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

  const { data, error } = await client.auth.getUser()
  if (error || !data?.user) return unauthorised()
  const user = data.user

  const claims = decodeAccessTokenClaims(accessToken)
  if (!claims) return unauthorised()

  if (claims.aal === 'aal1' && (await hasVerifiedMfaFactor(user.id))) {
    return { ok: false, status: 403, sentence: AAL_REFUSAL }
  }

  const { data: rows, error: memberError } = await client
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
  if (memberError) return unauthorised()

  const memberships = ((rows ?? []) as { organisation_id: string; role: string }[]).map((r) => ({
    organisationId: r.organisation_id,
    role: r.role as OrgRole,
  }))
  if (memberships.length === 0 || memberships.every((m) => m.role === 'client_viewer')) {
    return { ok: false, status: 403, sentence: CONNECT_REFUSAL }
  }

  return { ok: true, ctx: { accessToken, user, claims }, memberships }
}
