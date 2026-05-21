import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NewTemplateTabbed } from './NewTemplateTabbed'

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

export default async function NewTemplatePage() {
  const orgId = await getOrgId()

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/inspections/templates"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Templates
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">New Inspection Template</h1>
          <p className="page-subtitle">
            Build visually or paste JSON directly. The server validates against the schema before saving.
          </p>
        </div>
      </div>

      <NewTemplateTabbed organisationId={orgId} />
    </div>
  )
}
