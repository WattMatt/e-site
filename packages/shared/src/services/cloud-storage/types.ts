/**
 * Cloud-storage provider abstraction. Phase 1 supports Dropbox, Google
 * Drive, and Microsoft OneDrive (via Graph). Implementations live in the
 * sibling *.provider.ts files; resolve them by name with
 * getCloudStorageProvider() from index.ts.
 *
 * Tokens received from any provider must be encrypted via @esite/db's
 * encryptToken before being stored in public.org_storage_connections.
 * The provider interface deliberately works in plaintext — encryption is
 * the caller's (server-action / edge function) responsibility.
 */

export type ProviderName = 'dropbox' | 'google_drive' | 'onedrive' | 'dropbox_team'

export interface TokenBundle {
  accessToken: string
  refreshToken: string
  /** Comma-or-space-separated scope list. Provider-dependent format. */
  scope: string | null
  expiresAt: Date | null
  /** Cloud account email — display label for /settings/integrations. */
  accountEmail: string
  /**
   * Team metadata, populated by team-scoped providers (e.g. dropbox_team).
   * teamId       — provider's team identifier (Dropbox: "dbtid:...")
   * teamName     — display label (e.g. "WATSON MATTHEUS")
   * teamMemberId — installing admin's per-team identity (Dropbox: "dbmid:...")
   *                — sent as Dropbox-API-Select-User on /files/* calls so the
   *                team token acts as the admin during listing/downloads.
   */
  teamId?: string
  teamName?: string
  teamMemberId?: string
}

export interface CloudItem {
  /**
   * Provider-stable ID. Survives renames; for Dropbox it's the "id:..." form
   * returned by list_folder; for Drive it's the file ID; for Graph it's the
   * driveItem ID.
   */
  id: string
  name: string
  type: 'file' | 'folder'
  /** Provider-stable parent folder ID, if not at root. */
  parentId?: string
  /** Human-readable path — display only, do not key by it. */
  path?: string
  /** Bytes; only on files. */
  size?: number
  /** MIME type from the provider, if known. */
  mimeType?: string
  modifiedAt?: Date
  /** Revision/etag for change detection during sync. */
  revisionId?: string
}

export interface DownloadResult {
  body: ReadableStream<Uint8Array>
  contentType: string
  contentLength?: number
  /** Filename to use when persisting in Supabase Storage. */
  filename: string
}

export interface AuthorizeOptions {
  /**
   * Random opaque value that will round-trip back to /auth/cloud-callback.
   * Should be a signed HMAC of (user_id, nonce, ttl) so the callback can
   * verify the OAuth flow originated from us and isn't being injected.
   */
  state: string
  /** Where the provider should send the user back. Must match a registered URI. */
  redirectUri: string
}

export interface ExchangeCodeOptions {
  code: string
  redirectUri: string
}

export interface ListFolderOptions {
  /** null = root of the user's drive. */
  folderId: string | null
  accessToken: string
  /** Opaque cursor returned by a previous listFolder call. */
  pageToken?: string
  /**
   * Optional Dropbox team_member_id ("dbmid:...") — for dropbox_team provider
   * only, sent as `Dropbox-API-Select-User` so the team token acts as that
   * member during the call. Other providers ignore this field.
   */
  selectUserId?: string
}

export interface ListFolderResult {
  items: CloudItem[]
  /** If present, more pages are available — pass to listFolder.pageToken. */
  nextPageToken?: string
}

export interface DownloadOptions {
  fileId: string
  accessToken: string
  /** See ListFolderOptions.selectUserId. */
  selectUserId?: string
}

/**
 * The provider abstraction. All methods are async; HTTP / API errors
 * surface as CloudStorageError (see provider-utils.ts).
 */
export interface CloudStorageProvider {
  readonly name: ProviderName

  /** OAuth authorization URL for the user's browser to visit. */
  buildAuthUrl(opts: AuthorizeOptions): string

  /** Exchange an OAuth code (from the redirect callback) for a token bundle. */
  exchangeCode(opts: ExchangeCodeOptions): Promise<TokenBundle>

  /**
   * Refresh an expired access token. Returns a new bundle. Some providers
   * rotate the refresh token (Microsoft) — callers should always replace
   * the stored refreshToken with the returned value.
   */
  refreshTokens(refreshToken: string): Promise<TokenBundle>

  /**
   * Best-effort revoke at the provider. Safe to no-op if the provider
   * doesn't expose a revoke endpoint. Does NOT delete the local row.
   */
  revoke(refreshToken: string): Promise<void>

  /** List one page of immediate children of a folder. */
  listFolder(opts: ListFolderOptions): Promise<ListFolderResult>

  /** Stream a file's content. Caller pipes the body to Supabase Storage. */
  downloadFile(opts: DownloadOptions): Promise<DownloadResult>
}
