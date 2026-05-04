import { describe, it, expect, afterEach } from 'vitest'
import { GoogleDriveProvider } from '../../services/cloud-storage/google-drive.provider'
import { scriptFetch, withProviderCreds } from './test-helpers'

describe('GoogleDriveProvider', () => {
  withProviderCreds()
  const provider = new GoogleDriveProvider()
  const originalFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = originalFetch })

  describe('buildAuthUrl', () => {
    it('produces a Google authorize URL with access_type=offline + prompt=consent', () => {
      const url = provider.buildAuthUrl({ state: 'S', redirectUri: 'https://e/cb' })
      const u = new URL(url)
      expect(u.host).toBe('accounts.google.com')
      expect(u.pathname).toBe('/o/oauth2/v2/auth')
      expect(u.searchParams.get('access_type')).toBe('offline')
      expect(u.searchParams.get('prompt')).toBe('consent')
      expect(u.searchParams.get('scope')).toContain('drive.readonly')
      expect(u.searchParams.get('state')).toBe('S')
    })
  })

  describe('exchangeCode', () => {
    it('returns bundle with refresh_token + email from /userinfo', async () => {
      const script = scriptFetch([
        {
          url: 'oauth2.googleapis.com/token',
          method: 'POST',
          bodyContains: 'grant_type=authorization_code',
          json: {
            access_token: 'GAT', refresh_token: 'GRT',
            expires_in: 3600, scope: 'drive.readonly userinfo.email',
          },
        },
        { url: '/userinfo', json: { email: 'user@gmail.com' } },
      ])
      const bundle = await provider.exchangeCode({ code: 'C', redirectUri: 'https://e/cb' })
      expect(bundle.accessToken).toBe('GAT')
      expect(bundle.refreshToken).toBe('GRT')
      expect(bundle.accountEmail).toBe('user@gmail.com')
      script.assertExhausted()
    })

    it('throws a clear error if Google withholds refresh_token', async () => {
      scriptFetch([
        {
          url: 'oauth2.googleapis.com/token',
          json: { access_token: 'AT', expires_in: 3600 },
        },
      ])
      await expect(
        provider.exchangeCode({ code: 'C', redirectUri: 'https://e/cb' }),
      ).rejects.toThrow(/myaccount\.google\.com\/permissions/)
    })
  })

  describe('refreshTokens', () => {
    it('preserves the input refresh_token (Google does not rotate)', async () => {
      scriptFetch([
        { url: 'oauth2.googleapis.com/token', json: { access_token: 'GAT2', expires_in: 3600 } },
        { url: '/userinfo', json: { email: 'u@g.com' } },
      ])
      const bundle = await provider.refreshTokens('OLD-RT')
      expect(bundle.refreshToken).toBe('OLD-RT')
      expect(bundle.accessToken).toBe('GAT2')
    })
  })

  describe('listFolder', () => {
    it('queries with parent=root by default and maps Drive items', async () => {
      scriptFetch([
        {
          url: 'drive/v3/files',
          json: {
            files: [
              {
                id: 'F1', name: 'Drawings',
                mimeType: 'application/vnd.google-apps.folder',
                parents: ['root'],
              },
              {
                id: 'P1', name: 'plan.pdf', mimeType: 'application/pdf',
                size: '1024', parents: ['F1'],
                modifiedTime: '2026-04-01T10:00:00Z', headRevisionId: 'rev1',
              },
            ],
            nextPageToken: 'NPT',
          },
        },
      ])
      const r = await provider.listFolder({ folderId: null, accessToken: 'AT' })
      expect(r.items).toHaveLength(2)
      expect(r.items[0]).toMatchObject({ type: 'folder', name: 'Drawings' })
      expect(r.items[1]).toMatchObject({
        type: 'file', name: 'plan.pdf', size: 1024,
        mimeType: 'application/pdf', revisionId: 'rev1',
      })
      expect(r.nextPageToken).toBe('NPT')
    })

    it('escapes single-quotes in folder IDs to avoid query injection', async () => {
      const cap = scriptFetch([
        { url: 'drive/v3/files', json: { files: [] } },
      ])
      await provider.listFolder({ folderId: "weird'id", accessToken: 'AT' })
      // After string-level escape ("weird\'id") and URL.searchParams encoding,
      // the URL contains "weird%5C%27id" — backslash is %5C, apostrophe %27.
      const calledUrl = cap.calls[0]?.url ?? ''
      expect(calledUrl).toContain('weird%5C%27id')
    })
  })

  describe('downloadFile', () => {
    it('fetches metadata then streams ?alt=media', async () => {
      scriptFetch([
        {
          url: 'drive/v3/files/PID?fields=',
          json: {
            id: 'PID', name: 'spec.pdf', mimeType: 'application/pdf', size: '12345',
          },
        },
        {
          url: 'drive/v3/files/PID?alt=media',
          text: 'pdfbytes',
          headers: { 'content-type': 'application/pdf' },
        },
      ])
      const r = await provider.downloadFile({ fileId: 'PID', accessToken: 'AT' })
      expect(r.filename).toBe('spec.pdf')
      expect(r.contentType).toBe('application/pdf')
      expect(r.contentLength).toBe(12345)
    })

    it('refuses to download a folder', async () => {
      scriptFetch([
        {
          url: 'drive/v3/files/F',
          json: { id: 'F', name: 'A folder', mimeType: 'application/vnd.google-apps.folder' },
        },
      ])
      await expect(
        provider.downloadFile({ fileId: 'F', accessToken: 'AT' }),
      ).rejects.toThrow(/cannot download a folder/)
    })
  })
})
