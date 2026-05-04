'use server'

/**
 * Cloud-storage server actions — start the OAuth flow, disconnect a
 * connection. Token exchange happens in /api/auth/cloud-callback (route
 * handler) because it has to handle the GET redirect from the provider;
 * server actions can't be invoked from a browser navigation.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  ALL_PROVIDERS,
  getCloudStorageProvider,
  signOAuthState,
  type ProviderName,
} from '@esite/shared'
import { disconnectCloudConnection } from '@/services/cloud-storage.server'

const REDIRECT_PATH = '/api/auth/cloud-callback'

function siteUrl(): string {
  // Prefer NEXT_PUBLIC_SITE_URL when configured; fall back to the Vercel-
  // production URL (esite-lilac.vercel.app) for local/preview where the
  // env may be unset. The redirect URI MUST match what's registered with
  // each provider's OAuth app — Phase 1 registrations use NEXT_PUBLIC_SITE_URL.
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'https://esite-lilac.vercel.app'
}

/**
 * Start an OAuth flow for the given provider. Returns the auth URL the
 * caller should redirect the browser to. Caller is responsible for the
 * actual redirect (server action returns are JSON; the calling component
 * does `window.location.href = result.authUrl`).
 *
 * Throws if the user has no active org membership (i.e., they're an
 * orphan account that hasn't been onboarded).
 */
export async function startCloudOAuthAction(
  provider: ProviderName,
): Promise<{ authUrl: string }> {
  if (!ALL_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}`)
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (!mem) throw new Error('No active organisation membership')

  const state = await signOAuthState({
    uid: user.id,
    orgId: (mem as { organisation_id: string }).organisation_id,
    provider,
  })
  const redirectUri = `${siteUrl()}${REDIRECT_PATH}`
  const authUrl = getCloudStorageProvider(provider).buildAuthUrl({
    state,
    redirectUri,
  })
  return { authUrl }
}

/**
 * Disconnect a cloud-storage connection. Calls the provider's revoke
 * endpoint (best-effort) and deletes the local row. Triggers
 * /settings/integrations revalidation.
 */
export async function disconnectCloudConnectionAction(
  connectionId: string,
): Promise<{ ok: true }> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    throw new Error('Invalid connection id')
  }
  const supabase = await createClient()
  await disconnectCloudConnection(connectionId, supabase)
  revalidatePath('/settings/integrations')
  return { ok: true }
}
