import { describe, it, expect, afterEach, vi } from 'vitest'
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
      // Files.ReadWrite.All since Session 25 (handover cloud-mirror writes).
      expect(u.searchParams.get('scope')).toContain('Files.ReadWrite.All')
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

    it('refuses a pageToken that is not a graph.microsoft.com URL, without fetching (the bearer never leaves)', async () => {
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy as unknown as typeof fetch
      for (const bad of [
        'https://evil.example/x',
        'http://graph.microsoft.com/v1.0/me/drive/items/F1/children',
        'https://graph.microsoft.com.evil.example/v1.0/x',
        'https://evil@graph.microsoft.com.evil.example/x',
        'https://user:pass@graph.microsoft.com/v1.0/x',
        'https://graph.microsoft.com:8443/v1.0/x',
        'not a url',
        '/v1.0/me/drive/root/children',
      ]) {
        await expect(provider.listFolder({ folderId: 'F1', accessToken: 'AT', pageToken: bad }), bad).rejects.toThrow(/page token/i)
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('still follows a genuine https://graph.microsoft.com/v1.0 nextLink with the bearer', async () => {
      const next = 'https://graph.microsoft.com/v1.0/me/drive/items/F1/children?$skiptoken=XYZ'
      const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ value: [{ id: 'Y', name: 'y', folder: {} }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      globalThis.fetch = fetchSpy as unknown as typeof fetch
      const r = await provider.listFolder({ folderId: 'F1', accessToken: 'AT', pageToken: next })
      expect(r.items).toHaveLength(1)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe(next)
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer AT')
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
