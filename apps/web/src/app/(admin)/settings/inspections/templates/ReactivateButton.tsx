'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { reactivateTemplateAction } from '@/actions/inspections-template.actions'

export default function ReactivateButton({
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
        start(async () => {
          await reactivateTemplateAction(templateId, organisationId)
        })
      }}
    >
      {pending ? 'Reactivating…' : 'Reactivate'}
    </Button>
  )
}
