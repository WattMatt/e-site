import type {
  AuthorizeOptions,
  CloudItem,
  CloudStorageProvider,
  DownloadOptions,
  DownloadResult,
  ExchangeCodeOptions,
  ListFolderOptions,
  ListFolderResult,
  ProviderName,
  TokenBundle,
} from './types'
import { asProviderError, getProviderCredentials, postForm } from './provider-utils'

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke'
const API_BASE = 'https://api.dropboxapi.com/2'
const CONTENT_BASE = 'https://content.dropboxapi.com/2'
// `account_info.read` lets us call /users/get_current_account for the email label.
// `offline` access type produces a long-lived refresh token.
const SCOPES = 'files.content.read files.metadata.read account_info.read'

export class DropboxProvider implements CloudStorageProvider {
  readonly name: ProviderName = 'dropbox'

  buildAuthUrl(opts: AuthorizeOptions): string {
    const { clientId } = getProviderCredentials('dropbox')
    const u = new URL(AUTH_URL)
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('redirect_uri', opts.redirectUri)
    u.searchParams.set('state', opts.state)
    u.searchParams.set('token_access_type', 'offline')
    u.searchParams.set('scope', SCOPES)
    return u.toString()
  }

  async exchangeCode(opts: ExchangeCodeOptions): Promise<TokenBundle> {
    const { clientId, clientSecret } = getProviderCredentials('dropbox')
    const res = await postForm(TOKEN_URL, {
      code: opts.code,
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: opts.redirectUri,
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'token exchange')
    const j = (await res.json()) as DropboxTokenResponse
    if (!j.refresh_token) {
      throw new Error('dropbox: no refresh_token returned (token_access_type=offline?)')
    }
    const email = await this.getAccountEmail(j.access_token)
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      scope: j.scope ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
      accountEmail: email,
    }
  }

  async refreshTokens(refreshToken: string): Promise<TokenBundle> {
    const { clientId, clientSecret } = getProviderCredentials('dropbox')
    const res = await postForm(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'refresh tokens')
    const j = (await res.json()) as DropboxTokenResponse
    // Dropbox does not return a new refresh_token on refresh — preserve the input.
    const email = await this.getAccountEmail(j.access_token)
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? refreshToken,
      scope: j.scope ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
      accountEmail: email,
    }
  }

  async revoke(refreshToken: string): Promise<void> {
    // Dropbox revoke takes the access_token in the Authorization header,
    // not the refresh_token. Refresh first, then revoke. Best-effort.
    try {
      const fresh = await this.refreshTokens(refreshToken)
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${fresh.accessToken}` },
      })
    } catch {
      /* swallow — best effort */
    }
  }

  async listFolder(opts: ListFolderOptions): Promise<ListFolderResult> {
    // Dropbox uses path semantics — null/empty is the root, folder IDs are
    // the "id:..." strings returned by previous list_folder calls.
    // Pagination switches the endpoint to /list_folder/continue.
    const url = opts.pageToken
      ? `${API_BASE}/files/list_folder/continue`
      : `${API_BASE}/files/list_folder`
    const body = opts.pageToken
      ? { cursor: opts.pageToken }
      : { path: opts.folderId ?? '', recursive: false, include_non_downloadable_files: false }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'list folder')
    const j = (await res.json()) as DropboxListFolderResponse
    return {
      items: j.entries.filter((e) => e['.tag'] !== 'deleted').map(toCloudItem),
      nextPageToken: j.has_more ? j.cursor : undefined,
    }
  }

  async downloadFile(opts: DownloadOptions): Promise<DownloadResult> {
    const res = await fetch(`${CONTENT_BASE}/files/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        // Dropbox requires the file path/id in this header, NOT the body.
        'Dropbox-API-Arg': JSON.stringify({ path: opts.fileId }),
      },
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'download')
    if (!res.body) throw new Error('dropbox: download response body is empty')
    let filename = 'unknown'
    let contentLength: number | undefined
    const meta = res.headers.get('dropbox-api-result')
    if (meta) {
      try {
        const parsed = JSON.parse(meta) as { name?: string; size?: number }
        filename = parsed.name ?? filename
        contentLength = parsed.size
      } catch {
        /* swallow */
      }
    }
    if (contentLength === undefined) {
      const cl = res.headers.get('content-length')
      contentLength = cl ? Number(cl) : undefined
    }
    return {
      body: res.body,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      contentLength,
      filename,
    }
  }

  private async getAccountEmail(accessToken: string): Promise<string> {
    // /users/get_current_account is a POST with no body.
    const res = await fetch(`${API_BASE}/users/get_current_account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'get account')
    const j = (await res.json()) as { email?: string }
    if (!j.email) throw new Error('dropbox: get_current_account returned no email')
    return j.email
  }
}

interface DropboxTokenResponse {
  access_token: string
  /** Present on initial exchange; sometimes on refresh. */
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

interface DropboxFileEntry {
  '.tag': 'file' | 'folder' | 'deleted'
  id: string
  name: string
  path_display?: string
  path_lower?: string
  size?: number
  rev?: string
  client_modified?: string
  server_modified?: string
}

interface DropboxListFolderResponse {
  entries: DropboxFileEntry[]
  cursor: string
  has_more: boolean
}

function toCloudItem(e: DropboxFileEntry): CloudItem {
  return {
    id: e.id,
    name: e.name,
    type: e['.tag'] === 'folder' ? 'folder' : 'file',
    path: e.path_display ?? e.path_lower,
    size: e.size,
    revisionId: e.rev,
    modifiedAt: e.server_modified ? new Date(e.server_modified) : undefined,
  }
}
