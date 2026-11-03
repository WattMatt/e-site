import { it, expect } from 'vitest'
import { protectedResourceMetadata, unauthorizedResponse } from './metadata'
it('names the resource and the Supabase authorization server', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.e-site.live'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
  expect(protectedResourceMetadata()).toEqual({ resource: 'https://www.e-site.live/api/mcp', authorization_servers: ['https://ref.supabase.co/auth/v1'], bearer_methods_supported: ['header'], scopes_supported: ['openid', 'email', 'profile'] })
})
it('challenges with the metadata URL', async () => {
  const r = unauthorizedResponse(401, 'Sign in required.')
  expect(r.status).toBe(401)
  expect(r.headers.get('WWW-Authenticate')).toBe('Bearer realm="e-site", resource_metadata="https://www.e-site.live/.well-known/oauth-protected-resource/api/mcp"')
  expect(await r.json()).toEqual({ error: 'Sign in required.' })
})
