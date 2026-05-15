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

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API_BASE = 'https://www.googleapis.com/drive/v3'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
// drive.readonly lets us point at any folder the user already owns or has
// access to — covers shared drives via supportsAllDrives. Userinfo email
// is the display label.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')
const FILE_FIELDS = 'id,name,mimeType,size,parents,modifiedTime,headRevisionId'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export class GoogleDriveProvider implements CloudStorageProvider {
  readonly name: ProviderName = 'google_drive'

  buildAuthUrl(opts: AuthorizeOptions): string {
    const { clientId } = getProviderCredentials('google_drive')
    const u = new URL(AUTH_URL)
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('redirect_uri', opts.redirectUri)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('scope', SCOPES)
    u.searchParams.set('state', opts.state)
    u.searchParams.set('access_type', 'offline')   // ensures refresh_token
    u.searchParams.set('prompt', 'consent')        // forces refresh_token even on re-auth
    u.searchParams.set('include_granted_scopes', 'true')
    return u.toString()
  }

  async exchangeCode(opts: ExchangeCodeOptions): Promise<TokenBundle> {
    const { clientId, clientSecret } = getProviderCredentials('google_drive')
    const res = await postForm(TOKEN_URL, {
      code: opts.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    })
    if (!res.ok) throw await asProviderError(res, 'google_drive', 'token exchange')
    const j = (await res.json()) as GoogleTokenResponse
    if (!j.refresh_token) {
      // Google sometimes withholds refresh_token on re-consent. Telling the
      // user to revoke + retry is the only fix.
      throw new Error(
        'google_drive: no refresh_token returned. The user must revoke E-Site at ' +
          'https://myaccount.google.com/permissions and reconnect.',
      )
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
    const { clientId, clientSecret } = getProviderCredentials('google_drive')
    const res = await postForm(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    if (!res.ok) throw await asProviderError(res, 'google_drive', 'refresh tokens')
    const j = (await res.json()) as GoogleTokenResponse
    // Google does NOT issue a new refresh_token on refresh — preserve the input.
    const email = await this.getEmail(j.access_token)
    return {
      accessToken: j.access_token,
      refreshToken,
      scope: j.scope ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
      accountEmail: email,
    }
  }

  async revoke(refreshToken: string): Promise<void> {
    try {
      await postForm(REVOKE_URL, { token: refreshToken })
    } catch {
      /* swallow */
    }
  }

  async listFolder(opts: ListFolderOptions): Promise<ListFolderResult> {
    const parent = opts.folderId ?? 'root'
    const u = new URL(`${API_BASE}/files`)
    u.searchParams.set('q', `'${parent.replace(/'/g, "\\'")}' in parents and trashed = false`)
    u.searchParams.set('fields', `nextPageToken, files(${FILE_FIELDS})`)
    u.searchParams.set('pageSize', '200')
    u.searchParams.set('supportsAllDrives', 'true')
    u.searchParams.set('includeItemsFromAllDrives', 'true')
    if (opts.pageToken) u.searchParams.set('pageToken', opts.pageToken)
    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    })
    if (!res.ok) throw await asProviderError(res, 'google_drive', 'list folder')
    const j = (await res.json()) as DriveListResponse
    return {
      items: sortCloudItems(j.files.map(toDriveItem)),
      nextPageToken: j.nextPageToken,
    }
  }

  async downloadFile(opts: DownloadOptions): Promise<DownloadResult> {
    const id = encodeURIComponent(opts.fileId)
    // Metadata first for filename + content-type, then stream the bytes.
    const metaUrl = `${API_BASE}/files/${id}?fields=${FILE_FIELDS}&supportsAllDrives=true`
    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    })
    if (!metaRes.ok) throw await asProviderError(metaRes, 'google_drive', 'metadata')
    const meta = (await metaRes.json()) as DriveFile
    if (meta.mimeType === FOLDER_MIME) {
      throw new Error(`google_drive: cannot download a folder (id=${opts.fileId})`)
    }
    const dlUrl = `${API_BASE}/files/${id}?alt=media&supportsAllDrives=true`
    const dl = await fetch(dlUrl, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    })
    if (!dl.ok) throw await asProviderError(dl, 'google_drive', 'download')
    if (!dl.body) throw new Error('google_drive: download response body empty')
    return {
      body: dl.body,
      contentType: meta.mimeType ?? dl.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: meta.size ? Number(meta.size) : undefined,
      filename: meta.name,
    }
  }

  async createFolder(opts: CreateFolderOptions): Promise<CloudItem> {
    const u = new URL(`${API_BASE}/files`)
    u.searchParams.set('supportsAllDrives', 'true')
    u.searchParams.set('fields', FILE_FIELDS)
    const res = await fetch(u.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: opts.name,
        mimeType: FOLDER_MIME,
        // null parent → My Drive root.
        parents: opts.parentFolderId ? [opts.parentFolderId] : undefined,
      }),
    })
    if (!res.ok) throw await asProviderError(res, 'google_drive', 'create folder')
    const f = (await res.json()) as DriveFile
    return toDriveItem(f)
  }

  async uploadFile(opts: UploadFileOptions): Promise<CloudItem> {
    // Multipart upload — one POST carries metadata + body. Limit ~5 MB
    // is the practical comfort zone before we should switch to resumable
    // (Phase-2).
    const boundary = `b${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    const mime = opts.mimeType ?? 'application/octet-stream'
    const metaJson = JSON.stringify({
      name: opts.name,
      parents: [opts.parentFolderId],
      mimeType: opts.mimeType,
    })
    const enc = new TextEncoder()
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n` +
        `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    )
    const tail = enc.encode(`\r\n--${boundary}--`)
    const body = new Uint8Array(head.length + opts.body.length + tail.length)
    body.set(head, 0)
    body.set(opts.body, head.length)
    body.set(tail, head.length + opts.body.length)

    const u = new URL('https://www.googleapis.com/upload/drive/v3/files')
    u.searchParams.set('uploadType', 'multipart')
    u.searchParams.set('supportsAllDrives', 'true')
    u.searchParams.set('fields', FILE_FIELDS)
    const res = await fetch(u.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })
    if (!res.ok) throw await asProviderError(res, 'google_drive', 'upload')
    const f = (await res.json()) as DriveFile
    return toDriveItem(f)
  }

  private async getEmail(accessToken: string): Promise<string> {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw await asProviderError(res, 'google_drive', 'userinfo')
    const j = (await res.json()) as { email?: string }
    if (!j.email) throw new Error('google_drive: userinfo returned no email')
    return j.email
  }
}

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

interface DriveFile {
  id: string
  name: string
  mimeType?: string
  size?: string
  parents?: string[]
  modifiedTime?: string
  headRevisionId?: string
}

interface DriveListResponse {
  files: DriveFile[]
  nextPageToken?: string
}

function toDriveItem(f: DriveFile): CloudItem {
  const isFolder = f.mimeType === FOLDER_MIME
  return {
    id: f.id,
    name: f.name,
    type: isFolder ? 'folder' : 'file',
    parentId: f.parents?.[0],
    size: f.size ? Number(f.size) : undefined,
    mimeType: isFolder ? undefined : f.mimeType,
    modifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : undefined,
    revisionId: f.headRevisionId,
  }
}
