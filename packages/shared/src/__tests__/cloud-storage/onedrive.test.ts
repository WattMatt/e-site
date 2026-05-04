import { describe, it, expect, afterEach } from 'vitest'
import { OneDriveProvider } from '../../services/cloud-storage/onedrive.provider'
import { scriptFetch, withProviderCreds } from './test-helpers'

describe('OneDriveProvider', () => {
  withProviderCreds()
  const provider = new OneDriveProvider()
  const originalFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = originalFetch })

  describe('buildAuthUrl', () => {
    it('uses /common/ tenant + offline_access scope', () => {
      const url = provider.buildAuthUrl({ state: 'S', redirectUri: 'https://e/cb' })
      const u = new URL(url)
      expect(u.host).toBe('login.microsoftonline.com')
      expect(u.pathname).toBe('/common/oauth2/v2.0/authorize')
      expect(u.searchParams.get('scope')).toContain('offline_access')
      expect(u.searchParams.get('scope')).toContain('Files.Read.All')
      expect(u.searchParams.get('state')).toBe('S')
    })
  })

  describe('exchangeCode', () => {
    it('returns bundle with email pulled from /me.mail', async () => {
      const script = scriptFetch([
        {
          url: 'login.microsoftonline.com/common/oauth2/v2.0/token',
          method: 'POST',
          bodyContains: 'grant_type=authorization_code',
          json: {
            access_token: 'MAT', refresh_token: 'MRT',
            expires_in: 3600, scope: 'Files.Read.All offline_access',
          },
        },
        {
          url: 'graph.microsoft.com/v1.0/me',
          json: { mail: 'user@contoso.com', userPrincipalName: 'user@contoso.com' },
        },
      ])
      const bundle = await provider.exchangeCode({ code: 'C', redirectUri: 'https://e/cb' })
      expect(bundle.accessToken).toBe('MAT')
      expect(bundle.refreshToken).toBe('MRT')
      expect(bundle.accountEmail).toBe('user@contoso.com')
      script.assertExhausted()
    })

    it('falls back to userPrincipalName when mail is null', async () => {
      scriptFetch([
        {
          url: 'oauth2/v2.0/token',
          json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 },
        },
        {
          url: '/me',
          json: { userPrincipalName: 'upn@contoso.onmicrosoft.com' },
        },
      ])
      const bundle = await provider.exchangeCode({ code: 'C', redirectUri: 'https://e/cb' })
      expect(bundle.accountEmail).toBe('upn@contoso.onmicrosoft.com')
    })
  })

  describe('refreshTokens', () => {
    it('uses the rotated refresh_token from Microsoft (not the input)', async () => {
      scriptFetch([
        {
          url: 'oauth2/v2.0/token',
          json: { access_token: 'AT2', refresh_token: 'NEW-RT', expires_in: 3600 },
        },
        { url: '/me', json: { mail: 'u@m.com' } },
      ])
      const bundle = await provider.refreshTokens('OLD-RT')
      expect(bundle.accessToken).toBe('AT2')
      expect(bundle.refreshToken).toBe('NEW-RT')   // rotated!
    })

    it('throws if refresh response is missing refresh_token', async () => {
      scriptFetch([
        {
          url: 'oauth2/v2.0/token',
          json: { access_token: 'AT', expires_in: 3600 },
        },
      ])
      await expect(provider.refreshTokens('X')).rejects.toThrow(/refresh_token/)
    })
  })

  describe('listFolder', () => {
    it('lists root via /me/drive/root/children', async () => {
      scriptFetch([
        {
          url: '/me/drive/root/children',
          json: {
            value: [
              { id: 'F1', name: 'Drawings', folder: { childCount: 5 } },
              {
                id: 'P1', name: 'plan.pdf',
                file: { mimeType: 'application/pdf' },
                size: 2048,
                lastModifiedDateTime: '2026-04-01T10:00:00Z',
                cTag: 'cTag1', eTag: 'eTag1',
              },
            ],
          },
        },
      ])
      const r = await provider.listFolder({ folderId: null, accessToken: 'AT' })
      expect(r.items[0]).toMatchObject({ type: 'folder', name: 'Drawings' })
      expect(r.items[1]).toMatchObject({
        type: 'file', name: 'plan.pdf', size: 2048,
        mimeType: 'application/pdf', revisionId: 'cTag1',
      })
    })

    it('uses @odata.nextLink as full URL on continuation', async () => {
      const cap = scriptFetch([
        {
          url: 'graph.microsoft.com/v1.0/me/drive/items/F1/children?',
          json: {
            value: [{ id: 'X', name: 'x', folder: {} }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/items/F1/children?$skiptoken=ABC',
          },
        },
        {
          url: '$skiptoken=ABC',
          json: { value: [] },
        },
      ])
      const r1 = await provider.listFolder({ folderId: 'F1', accessToken: 'AT' })
      expect(r1.nextPageToken).toContain('$skiptoken=ABC')
      const r2 = await provider.listFolder({
        folderId: 'F1', accessToken: 'AT', pageToken: r1.nextPageToken!,
      })
      expect(r2.items).toHaveLength(0)
      cap.assertExhausted()
    })
  })

  describe('downloadFile', () => {
    it('fetches metadata then /content', async () => {
      scriptFetch([
        {
          url: '/me/drive/items/PID',
          json: {
            id: 'PID', name: 'spec.pdf',
            file: { mimeType: 'application/pdf' }, size: 999,
          },
        },
        {
          url: '/me/drive/items/PID/content',
          text: 'pdf',
          headers: { 'content-type': 'application/pdf' },
        },
      ])
      const r = await provider.downloadFile({ fileId: 'PID', accessToken: 'AT' })
      expect(r.filename).toBe('spec.pdf')
      expect(r.contentLength).toBe(999)
    })

    it('refuses to download a folder', async () => {
      scriptFetch([
        {
          url: '/me/drive/items/F',
          json: { id: 'F', name: 'A folder', folder: { childCount: 1 } },
        },
      ])
      await expect(
        provider.downloadFile({ fileId: 'F', accessToken: 'AT' }),
      ).rejects.toThrow(/cannot download a folder/)
    })
  })

  describe('revoke', () => {
    it('is a silent no-op (Graph has no revoke endpoint)', async () => {
      // No fetch script — should not call out at all.
      await expect(provider.revoke('any')).resolves.toBeUndefined()
    })
  })
})
