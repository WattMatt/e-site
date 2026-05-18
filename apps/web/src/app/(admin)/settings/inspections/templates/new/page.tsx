import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ImportForm from './ImportForm'

export const dynamic = 'force-dynamic'

async function getOrgId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!org) redirect('/onboarding')
  return org.organisation_id as string
}

export default async function ImportTemplatePage() {
  const orgId = await getOrgId()

  return (
    <div className="animate-fadeup" style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/settings/inspections/templates"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Templates
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Import Inspection Template</h1>
          <p className="page-subtitle">
            Paste a template JSON. The server validates against the schema and rejects malformed templates.
          </p>
        </div>
      </div>

      <ImportForm organisationId={orgId} />
    </div>
  )
}
