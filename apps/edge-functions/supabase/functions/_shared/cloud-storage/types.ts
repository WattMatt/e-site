// COPIED FROM the canonical implementation. DO NOT EDIT in place
// without also updating the source. Keep these byte-equivalent except
// for the canonical-path banner and Deno-style import extensions.
// Re-synced 2026-07-23 (drift: sortCloudItems was missing here).
//
// canonical: packages/shared/src/services/cloud-storage/types.ts

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

export type ProviderName = 'dropbox' | 'google_drive' | 'onedrive'

export interface TokenBundle {
  accessToken: string
  refreshToken: string
  /** Comma-or-space-separated scope list. Provider-dependent format. */
  scope: string | null
  expiresAt: Date | null
  /** Cloud account email — display label for /settings/integrations. */
  accountEmail: string
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
}

export interface ListFolderResult {
  items: CloudItem[]
  /** If present, more pages are available — pass to listFolder.pageToken. */
  nextPageToken?: string
}

export interface DownloadOptions {
  fileId: string
  accessToken: string
}

/**
 * Create a folder under a known parent. Used by features that mirror an
 * in-app folder tree (e.g. Handover Documents) into the user's cloud
 * provider so the same structure shows up in Dropbox / Drive / OneDrive
 * natively. `parentFolderId` of `null` means the provider's drive root —
 * callers should generally pass an explicit parent rooted under the
 * project's mapped cloud folder, not the drive root.
 */
export interface CreateFolderOptions {
  name: string
  parentFolderId: string | null
  accessToken: string
}

/**
 * Upload a file under a known parent folder. The caller supplies the bytes
 * as a Uint8Array (or anything BodyInit-compatible the provider's HTTP path
 * accepts — see individual implementations). MIME type is best-effort:
 * Dropbox ignores it, Drive uses it, Graph stores it as `file.mimeType`.
 *
 * For Phase 1, only "small" uploads are supported (<= 4 MB practical for
 * Graph; <= 150 MB hard for Dropbox /files/upload; Drive's simple media
 * upload is fine up to a few MB). Large-file resumable upload is a
 * separate Phase-2 method that we'll add when handover packs start
 * exceeding these limits in real use.
 */
export interface UploadFileOptions {
  name: string
  parentFolderId: string
  /** Raw bytes of the file. */
  body: Uint8Array
  /** MIME type — Drive + Graph honour this; Dropbox doesn't store it. */
  mimeType?: string
  accessToken: string
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

  /**
   * Create a folder under a parent. Returns the new folder's CloudItem
   * (the provider-stable `id` is the important field — callers persist it
   * alongside the local row to dedup later push-to-cloud retries).
   * Idempotency note: all three providers will happily create duplicate
   * folders with the same name in the same parent. Callers that want
   * idempotency should pre-check via listFolder + name match.
   */
  createFolder(opts: CreateFolderOptions): Promise<CloudItem>

  /**
   * Upload a file under a known parent folder. Returns the new file's
   * CloudItem. Like createFolder, this is NOT idempotent on the provider
   * side — re-running creates duplicate files (Dropbox appends " (1)",
   * Drive creates a fresh ID, Graph errors with @microsoft.graph.conflictBehavior=fail
   * unless overridden). Callers should check before retrying.
   */
  uploadFile(opts: UploadFileOptions): Promise<CloudItem>
}
