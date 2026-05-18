import { describe, it, expect, afterEach } from 'vitest'
import { DropboxProvider } from '../../services/cloud-storage/dropbox.provider'
import { CloudStorageError } from '../../services/cloud-storage/provider-utils'
import { scriptFetch, withProviderCreds } from './test-helpers'

describe('DropboxProvider', () => {
  withProviderCreds()
  const provider = new DropboxProvider()
  // Capture once at module load so afterEach can restore between tests.
  const originalFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = originalFetch })

  describe('buildAuthUrl', () => {
    it('produces a Dropbox authorize URL with offline access + scopes + state', () => {
      const url = provider.buildAuthUrl({ state: 'abc123', redirectUri: 'https://e/cb' })
      const u = new URL(url)
      expect(u.host).toBe('www.dropbox.com')
      expect(u.pathname).toBe('/oauth2/authorize')
      expect(u.searchParams.get('client_id')).toBe('test-dropbox-key')
      expect(u.searchParams.get('redirect_uri')).toBe('https://e/cb')
      expect(u.searchParams.get('state')).toBe('abc123')
      expect(u.searchParams.get('token_access_type')).toBe('offline')
      expect(u.searchParams.get('response_type')).toBe('code')
      expect(u.searchParams.get('scope')).toContain('files.content.read')
    })
  })

  describe('exchangeCode', () => {
    it('POSTs to token endpoint, fetches account, returns bundle', async () => {
      const script = scriptFetch([
        {
          url: 'api.dropboxapi.com/oauth2/token',
          method: 'POST',
          bodyContains: 'grant_type=authorization_code',
          json: {
            access_token: 'AT-1', refresh_token: 'RT-1',
            expires_in: 14400, scope: 'files.content.read',
          },
        },
        {
          url: '/users/get_current_account',
          method: 'POST',
          json: { email: 'user@dropbox.com' },
        },
      ])
      const bundle = await provider.exchangeCode({ code: 'CODE', redirectUri: 'https://e/cb' })
      expect(bundle.accessToken).toBe('AT-1')
      expect(bundle.refreshToken).toBe('RT-1')
      expect(bundle.accountEmail).toBe('user@dropbox.com')
      expect(bundle.scope).toBe('files.content.read')
      expect(bundle.expiresAt).toBeInstanceOf(Date)
      script.assertExhausted()
    })

    it('throws if Dropbox returns no refresh_token', async () => {
      scriptFetch([
        {
          url: 'oauth2/token',
          json: { access_token: 'AT', expires_in: 14400 },
        },
      ])
      await expect(
        provider.exchangeCode({ code: 'X', redirectUri: 'https://e/cb' }),
      ).rejects.toThrow(/refresh_token/)
    })

    it('wraps non-OK responses as CloudStorageError', async () => {
      scriptFetch([
        {
          url: 'oauth2/token',
          status: 400,
          json: { error_summary: 'invalid_grant', error: { '.tag': 'invalid_grant' } },
        },
      ])
      await expect(
        provider.exchangeCode({ code: 'BAD', redirectUri: 'https://e/cb' }),
      ).rejects.toMatchObject({
        name: 'CloudStorageError',
        provider: 'dropbox',
        status: 400,
        providerErrorCode: 'invalid_grant',
      })
    })
  })

  describe('refreshTokens', () => {
    it('preserves refresh_token if Dropbox does not rotate it', async () => {
      scriptFetch([
        { url: 'oauth2/token', json: { access_token: 'AT-2', expires_in: 14400 } },
        { url: 'get_current_account', json: { email: 'u@d.com' } },
      ])
      const bundle = await provider.refreshTokens('OLD-RT')
      expect(bundle.refreshToken).toBe('OLD-RT')
      expect(bundle.accessToken).toBe('AT-2')
    })
  })

  // listFolder + downloadFile probe /users/get_current_account once per access
  // token to detect team-namespace divergence (see dropbox.provider.ts comment
  // block "Team-namespace plumbing"). Tests below prepend a {email}-only stub
  // (no root_info → personal-account shape → path-root header omitted) and use
  // unique tokens per test to bypass the module-level rootInfoCache.
  describe('listFolder', () => {
    it('lists root and maps entries, dropping deleted', async () => {
      scriptFetch([
        { url: '/users/get_current_account', method: 'POST', json: { email: 'u@d.com' } },
        {
          url: '/files/list_folder',
          method: 'POST',
          bodyContains: '"path":""',
          json: {
            entries: [
              { '.tag': 'folder', id: 'id:f1', name: 'Drawings', path_display: '/Drawings' },
              {
                '.tag': 'file', id: 'id:p1', name: 'p.pdf', path_display: '/p.pdf',
                size: 100, rev: 'r1', server_modified: '2026-01-01T00:00:00Z',
              },
              { '.tag': 'deleted', id: 'id:gone', name: 'gone.pdf' },
            ],
            cursor: 'C', has_more: true,
          },
        },
      ])
      const r = await provider.listFolder({ folderId: null, accessToken: 'AT-list-root' })
      expect(r.items).toHaveLength(2)
      expect(r.items[0]).toMatchObject({ id: 'id:f1', type: 'folder', name: 'Drawings' })
      expect(r.items[1]).toMatchObject({
        id: 'id:p1', type: 'file', name: 'p.pdf', size: 100, revisionId: 'r1',
      })
      expect(r.items[1]?.modifiedAt).toBeInstanceOf(Date)
      expect(r.nextPageToken).toBe('C')
    })

    it('paginates via /list_folder/continue', async () => {
      scriptFetch([
        { url: '/users/get_current_account', method: 'POST', json: { email: 'u@d.com' } },
        {
          url: '/files/list_folder/continue',
          method: 'POST',
          bodyContains: '"cursor":"PAGE2"',
          json: { entries: [], cursor: 'C2', has_more: false },
        },
      ])
      const r = await provider.listFolder({ folderId: null, accessToken: 'AT-list-page', pageToken: 'PAGE2' })
      expect(r.items).toHaveLength(0)
      expect(r.nextPageToken).toBeUndefined()
    })
  })

  describe('downloadFile', () => {
    it('streams body and parses Dropbox-API-Result header for filename', async () => {
      scriptFetch([
        { url: '/users/get_current_account', method: 'POST', json: { email: 'u@d.com' } },
        {
          url: 'content.dropboxapi.com/2/files/download',
          method: 'POST',
          status: 200,
          text: 'hello bytes',
          headers: {
            'dropbox-api-result': JSON.stringify({ name: 'spec.pdf', size: 11 }),
            'content-type': 'application/pdf',
          },
        },
      ])
      const r = await provider.downloadFile({ fileId: 'id:p1', accessToken: 'AT-dl-named' })
      expect(r.filename).toBe('spec.pdf')
      expect(r.contentLength).toBe(11)
      expect(r.contentType).toBe('application/pdf')
      const reader = r.body.getReader()
      const { value } = await reader.read()
      expect(new TextDecoder().decode(value)).toBe('hello bytes')
    })

    it('falls back to "unknown" when header is missing', async () => {
      scriptFetch([
        { url: '/users/get_current_account', method: 'POST', json: { email: 'u@d.com' } },
        {
          url: 'files/download',
          status: 200,
          text: 'x',
        },
      ])
      const r = await provider.downloadFile({ fileId: 'id:p1', accessToken: 'AT-dl-unnamed' })
      expect(r.filename).toBe('unknown')
    })
  })
})
