/**
 * Dropbox TEAM-scoped provider (Architecture B).
 *
 * Differs from DropboxProvider (user-scoped) in three structural ways:
 *
 * 1. App credentials come from DROPBOX_TEAM_APP_KEY/SECRET (a separate app
 *    registered on dropbox.com/developers/apps with team_data.* scopes), not
 *    DROPBOX_APP_KEY/SECRET.
 *
 * 2. Token returned by exchangeCode is a TEAM TOKEN — calls authenticate as
 *    the team rather than an individual user. We capture the installing
 *    admin's team_member_id ("dbmid:...") + team_id ("dbtid:...") + team_name
 *    via /team/get_info + /team/members/list at exchange time.
 *
 * 3. /files/* calls send `Dropbox-API-Select-User: <member_id>` so the team
 *    token "acts as" that admin during listing/downloads. This is what gives
 *    the picker visibility into the team's full folder tree (vs being
 *    constrained to a single user's home namespace as in Architecture A).
 *    The Path-Root header from the user-scoped provider is NOT needed here
 *    because Select-User already places us at the admin's team-root context.
 */

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
// Team-scoped scopes selected on the dropbox.com app (see
// docs/cloud-storage-dropbox-team-migration-roadmap.md §2). team_data.member +
// team_data.team_space + members.read + team_info.read + files.team_metadata.read
// + account_info.read are the minimum set for the picker + bulk-sync flows.
const SCOPES = [
  'account_info.read',
  'team_info.read',
  'team_data.member',
  'team_data.team_space',
  'team_data.content.read',
  'files.team_metadata.read',
  'members.read',
].join(' ')

export class DropboxTeamProvider implements CloudStorageProvider {
  readonly name: ProviderName = 'dropbox_team'

  buildAuthUrl(opts: AuthorizeOptions): string {
    const { clientId } = getProviderCredentials('dropbox_team')
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
    const { clientId, clientSecret } = getProviderCredentials('dropbox_team')
    const res = await postForm(TOKEN_URL, {
      code: opts.code,
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: opts.redirectUri,
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox_team', 'token exchange')
    const j = (await res.json()) as DropboxTokenResponse
    if (!j.refresh_token) {
      throw new Error('dropbox_team: no refresh_token returned (token_access_type=offline?)')
    }
    // For team apps the response includes team_id; we still need a separate
    // call to /team/get_info for the team_name display label, plus the
    // installing admin's email + team_member_id from /team/members/get_info.
    // The admin is identified by the access token's bound user (the OAuth
    // installer) — use /team/token/get_authenticated_admin.
    const meta = await this.fetchInstallMetadata(j.access_token, j.team_id)
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      scope: j.scope ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
      accountEmail: meta.adminEmail,
      teamId: meta.teamId,
      teamName: meta.teamName,
      teamMemberId: meta.teamMemberId,
    }
  }

  async refreshTokens(refreshToken: string): Promise<TokenBundle> {
    const { clientId, clientSecret } = getProviderCredentials('dropbox_team')
    const res = await postForm(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox_team', 'refresh tokens')
    const j = (await res.json()) as DropboxTokenResponse
    // Refresh doesn't always include team_id; if so we re-fetch from team/get_info.
    const meta = await this.fetchInstallMetadata(j.access_token, j.team_id)
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? refreshToken,
      scope: j.scope ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
      accountEmail: meta.adminEmail,
      teamId: meta.teamId,
      teamName: meta.teamName,
      teamMemberId: meta.teamMemberId,
    }
  }

  async revoke(refreshToken: string): Promise<void> {
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
    const url = opts.pageToken
      ? `${API_BASE}/files/list_folder/continue`
      : `${API_BASE}/files/list_folder`
    const body = opts.pageToken
      ? { cursor: opts.pageToken }
      : { path: opts.folderId ?? '', recursive: false, include_non_downloadable_files: false }

    const res = await fetch(url, {
      method: 'POST',
      headers: this.teamHeaders(opts.accessToken, opts.selectUserId, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox_team', 'list folder')
    const j = (await res.json()) as DropboxListFolderResponse
    return {
      items: j.entries.filter((e) => e['.tag'] !== 'deleted').map(toCloudItem),
      nextPageToken: j.has_more ? j.cursor : undefined,
    }
  }

  async downloadFile(opts: DownloadOptions): Promise<DownloadResult> {
    const res = await fetch(`${CONTENT_BASE}/files/download`, {
      method: 'POST',
      headers: this.teamHeaders(opts.accessToken, opts.selectUserId, {
        'Dropbox-API-Arg': JSON.stringify({ path: opts.fileId }),
      }),
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox_team', 'download')
    if (!res.body) throw new Error('dropbox_team: download response body is empty')
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

  // ─────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Build headers for /files/* calls. team_member_id is REQUIRED — without
   * Select-User, team-scoped /files/* calls return 400. Caller must thread
   * the connection's stored team_member_id (captured at install time) into
   * every call.
   */
  private teamHeaders(
    accessToken: string,
    selectUserId: string | undefined,
    extra: Record<string, string>,
  ): Record<string, string> {
    if (!selectUserId) {
      throw new Error(
        'dropbox_team: missing selectUserId — every /files/* call needs the installing admin\'s team_member_id (Dropbox-API-Select-User header)',
      )
    }
    return {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Select-User': selectUserId,
      ...extra,
    }
  }

  /**
   * Resolve teamId/teamName/adminEmail/teamMemberId for a freshly-issued team
   * token. team_id is sometimes returned in the OAuth response — if so, we
   * trust it; otherwise we fetch from /team/get_info.
   *
   * For the admin's team_member_id + email, we use /team/token/get_authenticated_admin
   * which returns the admin who installed the token. (For team apps, the
   * "authenticated admin" is the user who completed the OAuth consent.)
   */
  private async fetchInstallMetadata(
    accessToken: string,
    tokenTeamId: string | undefined,
  ): Promise<{ teamId: string; teamName: string; teamMemberId: string; adminEmail: string }> {
    // /team/get_info returns the team's display name + a guaranteed team_id.
    const info = await this.callTeamApi(accessToken, '/team/get_info')
    const ti = info as { name?: string; team_id?: string }
    const teamId = tokenTeamId ?? ti.team_id ?? ''
    const teamName = ti.name ?? 'Unknown team'
    if (!teamId) {
      throw new Error('dropbox_team: /team/get_info returned no team_id')
    }
    // /team/token/get_authenticated_admin returns the admin who installed.
    const admin = await this.callTeamApi(accessToken, '/team/token/get_authenticated_admin')
    const ad = admin as { admin_profile?: { team_member_id?: string; email?: string } }
    const teamMemberId = ad.admin_profile?.team_member_id ?? ''
    const adminEmail = ad.admin_profile?.email ?? ''
    if (!teamMemberId || !adminEmail) {
      throw new Error('dropbox_team: /team/token/get_authenticated_admin missing admin_profile')
    }
    return { teamId, teamName, teamMemberId, adminEmail }
  }

  private async callTeamApi(accessToken: string, path: string): Promise<unknown> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw await asProviderError(res, 'dropbox_team', `team api ${path}`)
    return res.json()
  }
}

interface DropboxTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  /** Present on team-app token exchange. */
  team_id?: string
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
