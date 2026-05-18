'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { updateTemplateMetadataAction } from '@/actions/inspections-template.actions'

export default function DeprecateButton({
  templateId,
  organisationId,
}: {
  templateId: string
  organisationId: string
}) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            'Deprecate this template version? It will be hidden from the new-inspection picker; existing inspections continue to render.',
          )
        )
          return
        start(async () => {
          await updateTemplateMetadataAction(templateId, organisationId, {
            is_active: false,
          })
        })
      }}
    >
      {pending ? 'Deprecating…' : 'Deprecate'}
    </Button>
  )
}
