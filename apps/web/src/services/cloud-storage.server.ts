import 'server-only'

import { encryptToken } from '@esite/db'
import {
  ALL_PROVIDERS,
  CloudStorageError,
  getCloudStorageProvider,
  type ProviderName,
  type TokenBundle,
} from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side orchestration for cloud-storage OAuth: take a code from the
 * provider redirect, exchange it for tokens, encrypt the tokens, and
 * upsert into public.org_storage_connections. The caller (route handler)
 * supplies the Supabase client so RLS context is preserved.
 *
 * Web-only — never call from edge functions; they use their own helper.
 */

export interface ConnectArgs {
  provider: ProviderName
  code: string
  redirectUri: string
  organisationId: string
  /** auth.uid() of the user who initiated the OAuth flow. */
  connectedBy: string
}

export interface ConnectionRow {
  id: string
  provider: ProviderName
  account_email: string
}

/**
 * Round-trip the OAuth code → tokens → encrypted DB row. Returns the
 * connection metadata (no tokens, ever).
 */
export async function connectCloudProvider(
  args: ConnectArgs,
  supabase: SupabaseClient,
): Promise<ConnectionRow> {
  if (!ALL_PROVIDERS.includes(args.provider)) {
    throw new Error(`unsupported provider: ${args.provider}`)
  }
  const provider = getCloudStorageProvider(args.provider)

  let tokens: TokenBundle
  try {
    tokens = await provider.exchangeCode({ code: args.code, redirectUri: args.redirectUri })
  } catch (e) {
    if (e instanceof CloudStorageError) {
      // Re-throw as a more user-facing message; the route handler turns it
      // into an error redirect query param.
      throw new Error(
        `Failed to connect ${args.provider}: ${e.providerErrorCode ?? e.message}`,
      )
    }
    throw e
  }

  const accessEnc = await encryptToken(tokens.accessToken)
  const refreshEnc = await encryptToken(tokens.refreshToken)

  // PostgREST accepts BYTEA as `\x...` hex strings via the supabase-js client.
  const accessHex = uint8ToHex(accessEnc)
  const refreshHex = uint8ToHex(refreshEnc)

  // upsert on the unique (organisation_id, provider, account_email) tuple so
  // re-connecting the same Dropbox account replaces the old row instead of
  // erroring with "duplicate key" — the user expects a re-auth to "just work".
  const { data, error } = await supabase
    .from('org_storage_connections')
    .upsert(
      {
        organisation_id: args.organisationId,
        provider: args.provider,
        account_email: tokens.accountEmail,
        access_token_enc: accessHex,
        refresh_token_enc: refreshHex,
        scope: tokens.scope,
        expires_at: tokens.expiresAt?.toISOString() ?? null,
        connected_by: args.connectedBy,
      },
      { onConflict: 'organisation_id,provider,account_email' },
    )
    .select('id, provider, account_email')
    .single()

  if (error) {
    throw new Error(`Failed to store connection: ${error.message}`)
  }
  return data as unknown as ConnectionRow
}

/**
 * Best-effort revoke at the provider, then DELETE the local row. If the
 * provider revoke fails we still delete locally — better to lose the
 * server-side revoke than to leave the row stranded.
 */
export async function disconnectCloudConnection(
  connectionId: string,
  supabase: SupabaseClient,
): Promise<void> {
  // Need to read the encrypted refresh token to call provider.revoke. The
  // RLS SELECT policy lets any org member do this; the actual decryption
  // happens here on the server with the env-resolved key.
  const { data, error } = await supabase
    .from('org_storage_connections')
    .select('id, provider, refresh_token_enc')
    .eq('id', connectionId)
    .single()
  if (error || !data) {
    throw new Error(`Connection not found or not visible: ${error?.message ?? 'no row'}`)
  }

  // Decrypt + revoke (best effort).
  try {
    const { decryptToken } = await import('@esite/db')
    const refreshHex = (data as unknown as { refresh_token_enc: string }).refresh_token_enc
    const refresh = await decryptToken(hexToUint8(refreshHex))
    const provider = getCloudStorageProvider(
      (data as unknown as { provider: ProviderName }).provider,
    )
    await provider.revoke(refresh)
  } catch {
    /* swallow — best effort */
  }

  const { error: delErr } = await supabase
    .from('org_storage_connections')
    .delete()
    .eq('id', connectionId)
  if (delErr) {
    throw new Error(`Failed to delete connection: ${delErr.message}`)
  }
}

function uint8ToHex(bytes: Uint8Array): string {
  let s = '\\x'
  for (let i = 0; i < bytes.byteLength; i++) {
    s += bytes[i]!.toString(16).padStart(2, '0')
  }
  return s
}

function hexToUint8(hex: string): Uint8Array {
  // postgrest returns bytea as `\x...` (string) when the client is using
  // the default JSON parsing; supabase-js mirrors that.
  const stripped = hex.startsWith('\\x') ? hex.slice(2) : hex
  if (stripped.length % 2 !== 0) throw new Error('invalid bytea hex length')
  const out = new Uint8Array(stripped.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.substr(i * 2, 2), 16)
  }
  return out
}
