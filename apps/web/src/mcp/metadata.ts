const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')

export function protectedResourceMetadata(): {
  resource: string
  authorization_servers: string[]
  bearer_methods_supported: ['header']
  scopes_supported: ['openid', 'email', 'profile']
} {
  const supabase = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return {
    resource: `${site()}/api/mcp`,
    authorization_servers: [`${supabase}/auth/v1`],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile'],
  }
}

export function unauthorizedResponse(status: 401 | 403, sentence: string): Response {
  return Response.json(
    { error: sentence },
    {
      status,
      headers: {
        'WWW-Authenticate': `Bearer realm="e-site", resource_metadata="${site()}/.well-known/oauth-protected-resource/api/mcp"`,
      },
    },
  )
}
