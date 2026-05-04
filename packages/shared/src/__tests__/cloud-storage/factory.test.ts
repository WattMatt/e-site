import { describe, it, expect } from 'vitest'
import {
  ALL_PROVIDERS,
  CloudStorageError,
  DropboxProvider,
  GoogleDriveProvider,
  OneDriveProvider,
  getCloudStorageProvider,
} from '../../services/cloud-storage'

describe('cloud-storage factory + barrel', () => {
  it('returns the right concrete provider per name', () => {
    expect(getCloudStorageProvider('dropbox')).toBeInstanceOf(DropboxProvider)
    expect(getCloudStorageProvider('google_drive')).toBeInstanceOf(GoogleDriveProvider)
    expect(getCloudStorageProvider('onedrive')).toBeInstanceOf(OneDriveProvider)
  })

  it('exposes the provider name via the .name property', () => {
    expect(getCloudStorageProvider('dropbox').name).toBe('dropbox')
    expect(getCloudStorageProvider('google_drive').name).toBe('google_drive')
    expect(getCloudStorageProvider('onedrive').name).toBe('onedrive')
  })

  it('returns the same instance on repeated calls (provider is stateless)', () => {
    expect(getCloudStorageProvider('dropbox')).toBe(getCloudStorageProvider('dropbox'))
  })

  it('ALL_PROVIDERS lists every provider name once', () => {
    expect(new Set(ALL_PROVIDERS)).toEqual(new Set(['dropbox', 'google_drive', 'onedrive']))
    expect(ALL_PROVIDERS.length).toBe(3)
  })

  it('CloudStorageError is exported and constructible', () => {
    const e = new CloudStorageError('boom', 'dropbox', 500, 'rate_limited')
    expect(e.name).toBe('CloudStorageError')
    expect(e.provider).toBe('dropbox')
    expect(e.status).toBe(500)
    expect(e.providerErrorCode).toBe('rate_limited')
  })

  it('throws on unknown provider name', () => {
    // @ts-expect-error — runtime check for invalid input
    expect(() => getCloudStorageProvider('icloud')).toThrow(/Unknown cloud-storage provider/)
  })
})
