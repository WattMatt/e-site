import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ALL_PROVIDERS } from '@esite/shared'
import { ConnectProviderButton } from './ConnectProviderButton'
import { DisconnectButton } from './DisconnectButton'

interface Props {
  searchParams: Promise<{ connected?: string; error?: string; detail?: string }>
}

interface ConnectionRow {
  id: string
  provider: 'dropbox' | 'google_drive' | 'onedrive' | 'dropbox_team'
  account_email: string
  scope: string | null
  expires_at: string | null
  created_at: string
  team_id: string | null
  team_name: string | null
}

const PROVIDER_LABEL: Record<ConnectionRow['provider'], string> = {
  dropbox: 'Dropbox (Personal)',
  dropbox_team: 'Dropbox (Team)',
  google_drive: 'Google Drive',
  onedrive: 'Microsoft OneDrive',
}

export default async function IntegrationsPage({ searchParams }: Props) {
  const sp = await searchParams
  const supabase = await createClient()

  // Page-level role gate. /settings/integrations is org-management UX —
  // client_viewer (project-scoped read-only role per spec §3) has no
  // legitimate need to see or manage org-wide cloud connections, and
  // the RESTRICTIVE RLS policy on org_storage_connections from migration
  // 00040 would 403 their INSERT after they completed an OAuth round-trip
  // and granted a real provider token to E-Site that we couldn't store.
  // Cheaper to redirect them away from the page entirely.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/settings/integrations')
  const { data: mem } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (!mem || (mem as { role: string }).role === 'client_viewer') {
    redirect('/dashboard')
  }

  // Cast through `any` because org_storage_connections isn't yet in
  // packages/db/src/types.ts (regen pending in a polish commit).
  let connections: ConnectionRow[] = []
  let dbgError: string | null = null
  try {
    const { data, error } = await (supabase as any)
      .from('org_storage_connections')
      .select('id, provider, account_email, scope, expires_at, created_at, team_id, team_name')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[integrations] select error:', error)
      dbgError = `select: ${error.message ?? JSON.stringify(error)}`
    } else if (Array.isArray(data)) {
      connections = data as ConnectionRow[]
    } else {
      console.error('[integrations] unexpected data shape:', typeof data, data)
      dbgError = `unexpected data shape: ${typeof data}`
    }
  } catch (e) {
    console.error('[integrations] select threw:', e)
    dbgError = `threw: ${e instanceof Error ? e.message : String(e)}`
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/settings"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Settings
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Cloud-storage integrations</h1>
          <p className="page-subtitle">
            Connect Dropbox, Google Drive, or OneDrive to sync drawings and documents from a folder you choose per project.
          </p>
        </div>
      </div>

      {/* Flash banners */}
      {sp.connected && (
        <div style={banner('success')}>
          ✓ Connected {PROVIDER_LABEL[sp.connected as ConnectionRow['provider']] ?? sp.connected}.
        </div>
      )}
      {sp.error && (
        <div style={banner('error')}>
          ✕ Connection failed: {sp.error.replace(/_/g, ' ')}
          {sp.detail ? ` — ${sp.detail}` : ''}
        </div>
      )}
      {dbgError && (
        <div style={banner('error')}>
          ✕ Diagnostic: failed to load connections — {dbgError}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <h2 style={sectionHeading}>Active connections</h2>
        {connections.length === 0 ? (
          <p style={{ color: 'var(--c-text-dim)', fontSize: 13 }}>
            No cloud-storage connections yet. Connect one of the providers below to get started.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {connections.map((c) => (
              <li key={c.id} className="data-panel" style={connectionRow}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--c-text)' }}>
                    {PROVIDER_LABEL[c.provider]}
                    {c.provider === 'dropbox_team' && c.team_name && (
                      <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--c-text-mid)', fontSize: 12 }}>
                        · {c.team_name}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
                    {c.provider === 'dropbox_team'
                      ? `Installed by ${c.account_email}`
                      : c.account_email}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                    Connected {new Date(c.created_at).toISOString().slice(0, 10)}
                  </div>
                </div>
                <DisconnectButton connectionId={c.id} label={PROVIDER_LABEL[c.provider]} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 32 }}>
        <h2 style={sectionHeading}>Connect a new provider</h2>
        <p style={{ color: 'var(--c-text-dim)', fontSize: 13, marginBottom: 12 }}>
          You'll be redirected to the provider's consent screen, then brought back here. Tokens are encrypted at rest; only the email of the connected account is visible to your team.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ALL_PROVIDERS.map((p) => (
            <ConnectProviderButton key={p} provider={p} label={PROVIDER_LABEL[p]} />
          ))}
        </div>
      </div>
    </div>
  )
}

const sectionHeading: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--c-text-mid)',
  marginBottom: 12,
}

const connectionRow: React.CSSProperties = {
  padding: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

function banner(kind: 'success' | 'error'): React.CSSProperties {
  return {
    marginTop: 16,
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 13,
    background: kind === 'success' ? 'rgba(74, 222, 128, 0.08)' : 'rgba(248, 113, 113, 0.08)',
    border: `1px solid ${kind === 'success' ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`,
    color: kind === 'success' ? '#4ade80' : '#f87171',
  }
}
