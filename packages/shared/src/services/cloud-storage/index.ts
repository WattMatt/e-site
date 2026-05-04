import type { CloudStorageProvider, ProviderName } from './types'
import { DropboxProvider } from './dropbox.provider'
import { GoogleDriveProvider } from './google-drive.provider'
import { OneDriveProvider } from './onedrive.provider'

export * from './types'
export {
  CloudStorageError,
  getProviderCredentials,
  postForm,
  asProviderError,
} from './provider-utils'
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
