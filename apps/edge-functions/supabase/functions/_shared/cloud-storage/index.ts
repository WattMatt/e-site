// COPIED FROM the canonical implementation. DO NOT EDIT in place
// without also updating the source. Keep these byte-equivalent except
// for the canonical-path banner and Deno-style import extensions.
// Re-synced 2026-07-23 (drift: sortCloudItems was missing here).
//
// canonical: packages/shared/src/services/cloud-storage/index.ts

import type { CloudStorageProvider, ProviderName } from './types.ts'
import { DropboxProvider } from './dropbox.provider.ts'
import { GoogleDriveProvider } from './google-drive.provider.ts'
import { OneDriveProvider } from './onedrive.provider.ts'

export * from './types.ts'
export {
  CloudStorageError,
  getProviderCredentials,
  postForm,
  asProviderError,
} from './provider-utils.ts'
export { DropboxProvider, GoogleDriveProvider, OneDriveProvider }

const _instances: Record<ProviderName, CloudStorageProvider> = {
  dropbox: new DropboxProvider(),
  google_drive: new GoogleDriveProvider(),
  onedrive: new OneDriveProvider(),
}

/**
 * Look up a provider implementation by name. Throws on unknown names so
 * typos surface at the boundary, not deeper in the call chain.
 */
export function getCloudStorageProvider(name: ProviderName): CloudStorageProvider {
  const p = _instances[name]
  if (!p) throw new Error(`Unknown cloud-storage provider: ${name}`)
  return p
}

export const ALL_PROVIDERS: readonly ProviderName[] = ['dropbox', 'google_drive', 'onedrive']
