import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALL_PROVIDERS, type ProviderName, verifyOAuthState } from '@esite/shared'
import { connectCloudProvider } from '@/services/cloud-storage.server'

/**
 * GET /api/auth/cloud-callback
 *
 * Handles the OAuth redirect from Dropbox / Google Drive / OneDrive. The
 * provider sends us back to this URL with `?code=...&state=...&error=...`
 * query params. We:
 *   1. Verify the state HMAC (prevents CSRF + replay across providers).
 *   2. Verify the same provider claim is in state and the URL.
 *   3. Decode state to recover (uid, orgId, provider).
 *   4. Verify the current session matches the uid in state.
 *   5. Exchange the code for tokens, encrypt, and upsert the connection.
 *   6. Redirect to /settings/integrations with a success or error flash.
 *
 * Does NOT consume server actions because providers redirect the browser
 * with a GET — server actions are invoked from JS, not navigations.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')
  const providerParam = url.searchParams.get('provider')

  // Some providers omit `provider` from the redirect — we always have it
  // in state. We accept either; if `?provider=` is present we cross-check.
  if (errorParam) {
    return errorRedirect(req, errorParam)
  }
  if (!code || !state) {
    return errorRedirect(req, 'missing_code_or_state')
  }

  let payload: Awaited<ReturnType<typeof verifyOAuthState>>
  try {
    payload = await verifyOAuthState(state, {
      expectedProvider: providerParam && ALL_PROVIDERS.includes(providerParam as ProviderName)
        ? (providerParam as ProviderName)
        : undefined,
    })
  } catch (e) {
    return errorRedirect(req, 'invalid_state', e instanceof Error ? e.message : undefined)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return errorRedirect(req, 'not_signed_in')
  }
  if (user.id !== payload.uid) {
    // Different user finished the OAuth flow than started it.
    return errorRedirect(req, 'session_mismatch')
  }

  const redirectUri = `${url.origin}/api/auth/cloud-callback`
  try {
    await connectCloudProvider(
      {
        provider: payload.provider,
        code,
        redirectUri,
        organisationId: payload.orgId,
        connectedBy: user.id,
      },
      supabase,
    )
  } catch (e) {
    return errorRedirect(
      req,
      'exchange_failed',
      e instanceof Error ? e.message : 'unknown',
    )
  }

  // Success — redirect back to the integrations page with a flash.
  const dest = new URL('/settings/integrations', url.origin)
  dest.searchParams.set('connected', payload.provider)
  return NextResponse.redirect(dest)
}

function errorRedirect(req: NextRequest, reason: string, detail?: string): Response {
  const dest = new URL('/settings/integrations', req.nextUrl.origin)
  dest.searchParams.set('error', reason)
  if (detail) dest.searchParams.set('detail', detail)
  return NextResponse.redirect(dest)
}
