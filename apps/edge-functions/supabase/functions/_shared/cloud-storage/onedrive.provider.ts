// COPIED FROM the canonical implementation. DO NOT EDIT in place
// without also updating the source. Keep these byte-equivalent except
// for the canonical-path banner and Deno-style import extensions.
//
// canonical: packages/shared/src/services/cloud-storage/onedrive.provider.ts

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
} from './types.ts'
import { asProviderError, getProviderCredentials, postForm } from './provider-utils.ts'

// /common/ tenant covers both work/school accounts and personal Microsoft
// accounts (consumer OneDrive). For a single tenant locked down to e.g. a
// company directory, change /common/ to the tenant ID.
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
// offline_access produces a refresh token. Files.Read.All covers both
// personal OneDrive and SharePoint document libraries the user has access to.
const SCOPES = ['Files.Read.All', 'User.Read', 'offline_access'].join(' ')

export class OneDriveProvider implements CloudStorageProvider {
  readonly name: ProviderName = 'onedrive'

  buildAuthUrl(opts: AuthorizeOptions): string {
    const { clientId } = getProviderCredentials('onedrive')
    const u = new URL(AUTH_URL)
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('redirect_uri', opts.redirectUri)
    u.searchParams.set('response_mode', 'query')
    u.searchParams.set('scope', SCOPES)
    u.searchParams.set('state', opts.state)
    return u.toString()
  }

  async exchangeCode(opts: ExchangeCodeOptions): Promise<TokenBundle> {
    const { clientId, clientSecret } = getProviderCredentials('onedrive')
    const res = await postForm(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES,
    })
    if (!res.ok) throw await asProviderError(res, 'onedrive', 'token exchange')
    const j = (await res.json()) as MsTokenResponse
    if (!j.refresh_token) {
      throw new Error('onedrive: no refresh_token returned (offline_access scope missing?)')
    }
    const email = await this.getEmail(j.access_token)
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      scope: j.scope ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
      accountEmail: email,
    }
  }

  async refreshTokens(refreshToken: string): Promise<TokenBundle> {
    const { clientId, clientSecret } = getProviderCredentials('onedrive')
    const res = await postForm(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: SCOPES,
    })
    if (!res.ok) throw await asProviderError(res, 'onedrive', 'refresh tokens')
    const j = (await res.json()) as MsTokenResponse
    if (!j.refresh_token) {
      throw new Error('onedrive: refresh did not return a new refresh_token')
    }
    // Microsoft Graph DOES rotate refresh tokens — caller must persist the new one.
    const email = await this.getEmail(j.access_token)
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      scope: j.scope ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
      accountEmail: email,
    }
  }

  async revoke(_refreshToken: string): Promise<void> {
    // Graph doesn't expose a public revoke endpoint for delegated tokens.
    // The user must revoke via https://account.live.com/consent/Manage or,
    // for work/school, the tenant admin portal. Silent no-op is correct.
  }

  async listFolder(opts: ListFolderOptions): Promise<ListFolderResult> {
    if (opts.pageToken) {
      // Graph returns @odata.nextLink as a complete URL — use as-is.
      const res = await fetch(opts.pageToken, {
        headers: { Authorization: `Bearer ${opts.accessToken}` },
      })
      if (!res.ok) throw await asProviderError(res, 'onedrive', 'list folder (continue)')
      const j = (await res.json()) as GraphListResponse
      return { items: j.value.map(toGraphItem), nextPageToken: j['@odata.nextLink'] }
    }
    const path = opts.folderId
      ? `/me/drive/items/${encodeURIComponent(opts.folderId)}/children`
      : `/me/drive/root/children`
    const res = await fetch(`${GRAPH_BASE}${path}?$top=200`, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    })
    if (!res.ok) throw await asProviderError(res, 'onedrive', 'list folder')
    const j = (await res.json()) as GraphListResponse
    return { items: j.value.map(toGraphItem), nextPageToken: j['@odata.nextLink'] }
  }

  async downloadFile(opts: DownloadOptions): Promise<DownloadResult> {
    const id = encodeURIComponent(opts.fileId)
    // Metadata first for filename + content-type.
    const metaRes = await fetch(`${GRAPH_BASE}/me/drive/items/${id}`, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    })
    if (!metaRes.ok) throw await asProviderError(metaRes, 'onedrive', 'metadata')
    const meta = (await metaRes.json()) as GraphItem
    if (meta.folder) {
      throw new Error(`onedrive: cannot download a folder (id=${opts.fileId})`)
    }
    // /content endpoint serves the file body — fetch follows the pre-signed
    // download URL the API issues internally.
    const dl = await fetch(`${GRAPH_BASE}/me/drive/items/${id}/content`, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    })
    if (!dl.ok) throw await asProviderError(dl, 'onedrive', 'download')
    if (!dl.body) throw new Error('onedrive: download response body empty')
    return {
      body: dl.body,
      contentType: meta.file?.mimeType ?? dl.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: meta.size,
      filename: meta.name,
    }
  }

  async createFolder(opts: CreateFolderOptions): Promise<CloudItem> {
    const path = opts.parentFolderId
      ? `/me/drive/items/${encodeURIComponent(opts.parentFolderId)}/children`
      : `/me/drive/root/children`
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: opts.name,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    })
    if (!res.ok) throw await asProviderError(res, 'onedrive', 'create folder')
    const g = (await res.json()) as GraphItem
    return toGraphItem(g)
  }

  async uploadFile(opts: UploadFileOptions): Promise<CloudItem> {
    const path =
      `/me/drive/items/${encodeURIComponent(opts.parentFolderId)}` +
      `:/${encodeURIComponent(opts.name)}:/content`
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': opts.mimeType ?? 'application/octet-stream',
      },
      body: opts.body as unknown as BodyInit,
    })
    if (!res.ok) throw await asProviderError(res, 'onedrive', 'upload')
    const g = (await res.json()) as GraphItem
    return toGraphItem(g)
  }

  private async getEmail(accessToken: string): Promise<string> {
    const res = await fetch(`${GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw await asProviderError(res, 'onedrive', 'me')
    const j = (await res.json()) as { mail?: string; userPrincipalName?: string }
    const email = j.mail ?? j.userPrincipalName
    if (!email) throw new Error('onedrive: /me returned no email or userPrincipalName')
    return email
  }
}

interface MsTokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
  scope?: string
  token_type?: string
}

interface GraphItem {
  id: string
  name: string
  size?: number
  parentReference?: { id?: string; path?: string }
  lastModifiedDateTime?: string
  eTag?: string
  cTag?: string
  folder?: { childCount?: number }
  file?: { mimeType?: string }
}

interface GraphListResponse {
  value: GraphItem[]
  '@odata.nextLink'?: string
}

function toGraphItem(g: GraphItem): CloudItem {
  const isFolder = !!g.folder
  return {
    id: g.id,
    name: g.name,
    type: isFolder ? 'folder' : 'file',
    parentId: g.parentReference?.id,
    path: g.parentReference?.path,
    size: g.size,
    mimeType: g.file?.mimeType,
    modifiedAt: g.lastModifiedDateTime ? new Date(g.lastModifiedDateTime) : undefined,
    revisionId: g.cTag ?? g.eTag,
  }
}