'use client'

import { useRouter } from 'next/navigation'
import { useBuilderState, type TemplateDraft } from '../_builder/useBuilderState'
import { BuilderShell } from '../_builder/BuilderShell'
import { createTemplateAction } from '@/actions/inspections-template.actions'

interface Props {
  organisationId: string
  initialDraft?: Partial<TemplateDraft>
}

export function TemplateBuilderClient({ organisationId, initialDraft }: Props) {
  const builder = useBuilderState(initialDraft)
  const router = useRouter()

  const handleSave = async (validatedDraft: unknown) => {
    try {
      const jsonText = JSON.stringify(validatedDraft)
      const newId = await createTemplateAction(organisationId, jsonText)
      router.push(`/inspections/templates/${newId}`)
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  }

  return <BuilderShell builder={builder} onSave={handleSave} />
}
