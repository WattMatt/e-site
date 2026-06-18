// Shape Supabase Send Email hook delivers (standardwebhooks JSON body).
export interface AuthHookPayload {
  user: { id: string; email: string; user_metadata?: Record<string, unknown> }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: 'signup' | 'recovery' | 'invite' | 'magiclink' | 'email_change'
    site_url: string
    /** Present only for some flows; carried through when set. */
    token_new?: string
    token_hash_new?: string
  }
}

export interface OrgBranding {
  name: string
  /** data: URI or absolute URL; null falls back to platform branding. */
  logoSrc: string | null
  accent: string
}

export const DEFAULT_ACCENT = '#E69500'
export const PLATFORM_NAME = 'E-Site'
