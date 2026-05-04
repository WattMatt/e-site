/**
 * Shared helpers used by all three cloud-storage provider implementations.
 *
 *   - CloudStorageError: typed error with provider + status + provider-error-code
 *   - getProviderCredentials: read CLIENT_ID + CLIENT_SECRET per provider from env
 *   - postForm: form-urlencoded POST (the OAuth token-exchange standard)
 *   - asProviderError: turn a non-OK Response into a CloudStorageError
 */

import type { ProviderName } from './types'

export class CloudStorageError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly status?: number,
    public readonly providerErrorCode?: string,
  ) {
    super(message)
    this.name = 'CloudStorageError'
  }
}

export interface ProviderCredentials {
  clientId: string
  clientSecret: string
}

/**
 * Read provider OAuth credentials from env. Caller decides whether the
 * runtime is Node (Vercel server actions) or Deno (Supabase Edge); both
 * are handled.
 *
 * Per-provider env vars:
 *   - dropbox:      DROPBOX_APP_KEY        + DROPBOX_APP_SECRET
 *   - google_drive: GOOGLE_CLIENT_ID       + GOOGLE_CLIENT_SECRET
 *   - onedrive:     MS_GRAPH_CLIENT_ID     + MS_GRAPH_CLIENT_SECRET
 */
export function getProviderCredentials(provider: ProviderName): ProviderCredentials {
  const env = readEnv()
  const map: Record<ProviderName, { id: string; secret: string }> = {
    dropbox:      { id: 'DROPBOX_APP_KEY',    secret: 'DROPBOX_APP_SECRET' },
    google_drive: { id: 'GOOGLE_CLIENT_ID',   secret: 'GOOGLE_CLIENT_SECRET' },
    onedrive:     { id: 'MS_GRAPH_CLIENT_ID', secret: 'MS_GRAPH_CLIENT_SECRET' },
  }
  const { id, secret } = map[provider]
  const clientId = env(id)
  const clientSecret = env(secret)
  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${id} / ${secret} env vars for provider ${provider}`)
  }
  return { clientId, clientSecret }
}

declare const Deno: { env: { get: (n: string) => string | undefined } } | undefined
declare const process: { env: Record<string, string | undefined> } | undefined

function readEnv(): (k: string) => string | undefined {
  if (typeof process !== 'undefined' && process?.env) {
    return (k: string) => process.env[k]
  }
  if (typeof Deno !== 'undefined' && Deno?.env) {
    return (k: string) => Deno.env.get(k)
  }
  return () => undefined
}

/**
 * POST application/x-www-form-urlencoded — the OAuth token-exchange
 * standard for all 3 providers.
 */
export async function postForm(
  url: string,
  body: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
    },
    body: new URLSearchParams(body).toString(),
  })
}

/**
 * Map a non-OK Response to a CloudStorageError with provider context. Tries
 * to extract a provider-specific error code from the JSON body; falls back
 * to status text.
 */
export async function asProviderError(
  res: Response,
  provider: string,
  context: string,
): Promise<CloudStorageError> {
  let body = ''
  try { body = await res.text() } catch { /* swallow */ }
  let code: string | undefined
  try {
    const j = JSON.parse(body) as Record<string, unknown>
    // Normalize provider error shapes:
    //   Dropbox:  { error: { ".tag": "..." }, error_summary: "..." }
    //   Google:   { error: "...", error_description: "..." } OR { error: { code, message } }
    //   Graph:    { error: { code, message } }
    const e = j.error as Record<string, unknown> | string | undefined
    if (typeof e === 'string') code = e
    else if (e && typeof e === 'object') {
      code = (e['.tag'] as string) ?? (e.code as string) ?? (e.message as string)
    }
    code = code ?? (j.error_summary as string) ?? (j.error_description as string)
  } catch { /* swallow */ }
  const tail = code ? ` (${String(code)})` : ''
  return new CloudStorageError(
    `${provider} ${context} failed: HTTP ${res.status}${tail}`,
    provider,
    res.status,
    typeof code === 'string' ? code : undefined,
  )
}
