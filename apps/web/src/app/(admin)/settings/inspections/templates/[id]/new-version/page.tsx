import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTemplateAction } from '@/actions/inspections-template.actions'
import type { ParsedTemplate } from '@esite/shared'
import NewVersionForm from './NewVersionForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

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

export default async function NewVersionPage({ params }: Props) {
  const { id } = await params
  const orgId = await getOrgId()
  const source = await getTemplateAction(id) as {
    id: string
    template_id: string
    version: string
    name: string
    schema_json: ParsedTemplate
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/settings/inspections/templates/${source.id}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← {source.template_id} v{source.version}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">New Version: {source.name}</h1>
          <p className="page-subtitle">
            Cloning{' '}
            <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>
              {source.template_id} v{source.version}
            </code>
            . Bump the version field in the JSON before saving.
          </p>
        </div>
      </div>

      <NewVersionForm
        sourceId={source.id}
        organisationId={orgId}
        initialJson={JSON.stringify(source.schema_json, null, 2)}
      />
    </div>
  )
}
