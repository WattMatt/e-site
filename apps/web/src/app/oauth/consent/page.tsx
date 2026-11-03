import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { CONNECT_REFUSAL } from '@/mcp/auth'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import ConsentClient from './ConsentClient'

export const metadata: Metadata = { title: 'Connect to E-Site' }
export const dynamic = 'force-dynamic'

function Message({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'var(--c-base)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        <Card>
          <CardHeader>
            <h1 style={{ margin: 0, fontSize: 18, color: 'var(--c-text)' }}>Connect to E-Site</h1>
          </CardHeader>
          <CardBody>
            <p style={{ margin: 0, color: 'var(--c-text)' }}>{children}</p>
          </CardBody>
        </Card>
      </div>
    </main>
  )
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string | string[] }>
}) {
  const { authorization_id: rawId } = await searchParams
  const authorizationId = Array.isArray(rawId) ? rawId[0] : rawId
  if (!authorizationId) {
    return <Message>This authorization request is missing its identifier. Start the connection again from Claude.</Message>
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login?next=' + encodeURIComponent('/oauth/consent?authorization_id=' + authorizationId))
  }

  const { data: rows } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
  const memberships = (rows ?? []) as { organisation_id: string; role: string }[]
  if (memberships.length === 0 || memberships.every((m) => m.role === 'client_viewer')) {
    return <Message>{CONNECT_REFUSAL}</Message>
  }

  return <ConsentClient authorizationId={authorizationId} />
}
