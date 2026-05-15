import type {
  AuthorizeOptions,
  CloudItem,
  CloudStorageProvider,
  CreateFolderOptions,
  DownloadOptions,
  DownloadResult,
  ExchangeCodeOptions,
  ListFolderOptions,
  ListFolderResult,
  ProviderName,
  TokenBundle,
  UploadFileOptions,
} from './types'
import { asProviderError, getProviderCredentials, postForm, sortCloudItems } from './provider-utils'

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
      headers: await this.namespaceHeaders(opts.accessToken, {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'list folder')
    const j = (await res.json()) as DropboxListFolderResponse
    return {
      items: sortCloudItems(j.entries.filter((e) => e['.tag'] !== 'deleted').map(toCloudItem)),
      nextPageToken: j.has_more ? j.cursor : undefined,
    }
  }

  async downloadFile(opts: DownloadOptions): Promise<DownloadResult> {
    const res = await fetch(`${CONTENT_BASE}/files/download`, {
      method: 'POST',
      headers: await this.namespaceHeaders(opts.accessToken, {
        Authorization: `Bearer ${opts.accessToken}`,
        // Dropbox requires the file path/id in this header, NOT the body.
        'Dropbox-API-Arg': JSON.stringify({ path: opts.fileId }),
      }),
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

  async createFolder(opts: CreateFolderOptions): Promise<CloudItem> {
    // Dropbox's /files/create_folder_v2 takes a full path, not parent-id +
    // name. Resolve the parent's id-or-path to a path_display first, then
    // concat. parentFolderId === null means root of the resolved namespace.
    const parentPath = opts.parentFolderId
      ? await this.resolvePathFromId(opts.parentFolderId, opts.accessToken)
      : ''
    const path = `${parentPath}/${opts.name}`
    const res = await fetch(`${API_BASE}/files/create_folder_v2`, {
      method: 'POST',
      headers: await this.namespaceHeaders(opts.accessToken, {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ path, autorename: false }),
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'create folder')
    const j = (await res.json()) as { metadata: DropboxFileEntry }
    return toCloudItem(j.metadata)
  }

  async uploadFile(opts: UploadFileOptions): Promise<CloudItem> {
    // /files/upload accepts up to 150 MB in a single shot. Larger files
    // need /files/upload_session — Phase-2.
    const parentPath = await this.resolvePathFromId(opts.parentFolderId, opts.accessToken)
    const path = `${parentPath}/${opts.name}`
    const res = await fetch(`${CONTENT_BASE}/files/upload`, {
      method: 'POST',
      headers: await this.namespaceHeaders(opts.accessToken, {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/octet-stream',
        // Dropbox-API-Arg carries the upload metadata. mode=add fails on
        // conflict (autorename=false), which is what we want — caller
        // should pre-dedup.
        'Dropbox-API-Arg': JSON.stringify({
          path,
          mode: 'add',
          autorename: false,
          mute: true,
          strict_conflict: false,
        }),
      }),
      // Cast through BodyInit — Uint8Array IS valid at runtime (it's an
      // ArrayBufferView, which is a BufferSource, which is a BodyInit),
      // but TS 5.7's stricter Uint8Array<ArrayBufferLike> shape misses
      // the BufferSource overlap. Cast is the minimal-disruption fix.
      body: opts.body as unknown as BodyInit,
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'upload')
    const j = (await res.json()) as DropboxFileEntry
    return toCloudItem(j)
  }

  /**
   * Dropbox accepts both `path: "id:abc"` AND `path: "/foo/bar"` in most
   * /files/* endpoints, BUT /files/create_folder_v2 + /files/upload need
   * a literal path that can be composed with a child segment ("/Name").
   * If the caller already passed a path-style string (starts with "/" or
   * empty for root), return as-is. Otherwise round-trip via get_metadata
   * to resolve the id → path. No cache (paths can change via rename).
   */
  private async resolvePathFromId(
    idOrPath: string,
    accessToken: string,
  ): Promise<string> {
    if (idOrPath === '' || idOrPath.startsWith('/')) return idOrPath
    const res = await fetch(`${API_BASE}/files/get_metadata`, {
      method: 'POST',
      headers: await this.namespaceHeaders(accessToken, {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ path: idOrPath }),
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'get_metadata')
    const j = (await res.json()) as DropboxFileEntry
    return j.path_display ?? j.path_lower ?? ''
  }

  // ─────────────────────────────────────────────────────────────────────
  // Team-namespace plumbing
  //
  // Dropbox Business members have TWO namespaces visible to their account:
  //   - HOME (default)   → their personal member subfolder of the team root
  //   - ROOT             → the team's full folder tree (incl. shared team folders)
  //
  // Without `Dropbox-API-Path-Root: {".tag":"root","root":"<id>"}`, every
  // /files/* call defaults to HOME — so the folder picker only shows the
  // user's personal slice and team-shared content stays invisible.
  //
  // PREDICATE: detect "needs path-root header" by namespace divergence.
  //   root_info.root_namespace_id !== root_info.home_namespace_id
  //
  // Why divergence and NOT root_info[".tag"] === "team":
  //   Dropbox returns root_info[".tag"] = "team" ONLY when the caller's
  //   home IS the team root (e.g. team admin in admin context). For a
  //   normal team member, .tag is "user" even though they're in a team —
  //   their home is a personal subfolder of the team root and the two
  //   namespace IDs differ. Checking .tag === "team" misses every regular
  //   member, which is the entire user base. Confirmed via debug-route
  //   data 2026-05-13 (Watson Mattheus team, root=2606589667, home=51521165,
  //   .tag="user", account_type=business, team object present).
  //
  // For personal Dropbox accounts (no team), the two IDs are equal and the
  // header is omitted — sending it with the user's own root_namespace_id
  // would be a no-op anyway.
  //
  // root_info comes from /users/get_current_account; we cache it per access
  // token in-memory to avoid 1 extra round-trip per call. Cache key is the
  // access token itself, so token rotation invalidates naturally.
  // ─────────────────────────────────────────────────────────────────────

  private async namespaceHeaders(
    accessToken: string,
    base: Record<string, string>,
  ): Promise<Record<string, string>> {
    const ns = await this.getRootNamespaceId(accessToken)
    if (!ns) return base
    return {
      ...base,
      'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: ns }),
    }
  }

  private async getRootNamespaceId(accessToken: string): Promise<string | undefined> {
    const cached = rootInfoCache.get(accessToken)
    if (cached !== undefined) return cached.rootNamespaceId
    const info = await this.fetchAccountInfo(accessToken)
    const rootNamespaceId = deriveRootNamespaceId(info)
    rootInfoCache.set(accessToken, { email: info.email, rootNamespaceId })
    return rootNamespaceId
  }

  private async getAccountEmail(accessToken: string): Promise<string> {
    const cached = rootInfoCache.get(accessToken)
    if (cached) return cached.email
    const info = await this.fetchAccountInfo(accessToken)
    const rootNamespaceId = deriveRootNamespaceId(info)
    rootInfoCache.set(accessToken, { email: info.email, rootNamespaceId })
    return info.email
  }

  private async fetchAccountInfo(accessToken: string): Promise<DropboxAccountInfo> {
    // /users/get_current_account is a POST with no body. Returns email +
    // root_info (only present for v2 API responses, but we expect it).
    const res = await fetch(`${API_BASE}/users/get_current_account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox', 'get account')
    const j = (await res.json()) as DropboxAccountInfo
    if (!j.email) throw new Error('dropbox: get_current_account returned no email')
    return j
  }
}

interface DropboxAccountInfo {
  email: string
  root_info?: {
    '.tag': 'team' | 'user'
    root_namespace_id: string
    home_namespace_id: string
    home_path?: string
  }
  team?: {
    id: string
    name: string
  }
  account_type?: { '.tag': 'basic' | 'pro' | 'business' }
}

/**
 * Returns the team's root namespace id when the caller's home is BELOW the
 * team root (i.e. they're a team member, not at the root themselves), so
 * /files/* calls need `Dropbox-API-Path-Root` to escape the home namespace.
 * Returns undefined when:
 *   - root_info is missing entirely (very old API responses)
 *   - root_namespace_id === home_namespace_id (caller IS at the root —
 *     personal account, OR team admin in admin-context, OR single-user team)
 */
function deriveRootNamespaceId(info: DropboxAccountInfo): string | undefined {
  const ri = info.root_info
  if (!ri) return undefined
  if (ri.root_namespace_id === ri.home_namespace_id) return undefined
  return ri.root_namespace_id
}

// In-memory cache of root_info per access token.
// Access tokens are short-lived (~4h); cache eviction is implicit when the
// token rotates. Bound the size to prevent unbounded growth in long-running
// processes (edge functions / web server with many concurrent users).
const ROOT_INFO_CACHE_MAX = 256
class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly max: number) { super() }
  set(key: K, value: V): this {
    if (this.size >= this.max && !this.has(key)) {
      // Evict oldest insertion (Map preserves insertion order)
      const firstKey = this.keys().next().value
      if (firstKey !== undefined) this.delete(firstKey)
    }
    return super.set(key, value)
  }
}
const rootInfoCache = new BoundedMap<string, { email: string; rootNamespaceId: string | undefined }>(ROOT_INFO_CACHE_MAX)

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
