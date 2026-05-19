import Link from 'next/link'
import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTemplateAction, cloneTemplateToNewVersionAction } from '@/actions/inspections-template.actions'
import { TemplateBuilderClient } from '../../new/TemplateBuilderClient'
import type { TemplateDraft } from '../../_builder/useBuilderState'

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

export default async function CloneTemplatePage({ params }: Props) {
  const { id } = await params
  const orgId = await getOrgId()

  const source = await getTemplateAction(id) as {
    id: string
    template_id: string
    version: string
    name: string
  }

  if (!source) notFound()

  const result = await cloneTemplateToNewVersionAction(source.template_id, source.version)
  if (!result.ok) {
    return (
      <div className="animate-fadeup" style={{ maxWidth: 1200 }}>
        <div style={{ marginBottom: 16 }}>
          <Link
            href={`/settings/inspections/templates/${id}`}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
          >
            ← {source.template_id} v{source.version}
          </Link>
        </div>
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--c-red-dim)',
            border: '1px solid #6b1e1e',
            borderRadius: 6,
            color: 'var(--c-red)',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
          }}
        >
          Failed to prepare clone: {result.error}
        </div>
      </div>
    )
  }

  // draft.schema_json holds the bumped schema; spread it as the initial builder state
  const initialDraft: Partial<TemplateDraft> = result.draft.schema_json as Partial<TemplateDraft>

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/settings/inspections/templates/${id}`}
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
            </code>{' '}
            → v{result.draft.version}. Edit in the builder, then save.
          </p>
        </div>
      </div>

      <TemplateBuilderClient organisationId={orgId} initialDraft={initialDraft} />
    </div>
  )
}
