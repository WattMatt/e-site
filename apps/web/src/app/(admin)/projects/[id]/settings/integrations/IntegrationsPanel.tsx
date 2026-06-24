'use client'

import { useState, useTransition } from 'react'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { updateProjectSettingsAction } from '@/actions/project-settings.actions'

type ToggleField =
  | 'notifyRfiEmail'
  | 'notifyInspectionEmail'
  | 'notifySnagEmail'
  | 'notifyDiaryEmail'

interface Props {
  projectId: string
  initialNotifyRfiEmail: boolean
  initialNotifyInspectionEmail: boolean
  initialNotifySnagEmail: boolean
  initialNotifyDiaryEmail: boolean
}

export function IntegrationsPanel({
  projectId,
  initialNotifyRfiEmail,
  initialNotifyInspectionEmail,
  initialNotifySnagEmail,
  initialNotifyDiaryEmail,
}: Props) {
  const [values, setValues] = useState<Record<ToggleField, boolean>>({
    notifyRfiEmail: initialNotifyRfiEmail,
    notifyInspectionEmail: initialNotifyInspectionEmail,
    notifySnagEmail: initialNotifySnagEmail,
    notifyDiaryEmail: initialNotifyDiaryEmail,
  })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function toggle(field: ToggleField, value: boolean) {
    setValues(v => ({ ...v, [field]: value }))
    setError(null)
    startTransition(async () => {
      const result = await updateProjectSettingsAction(projectId, { [field]: value })
      if ('error' in result) {
        // Roll back optimistic update
        setValues(v => ({ ...v, [field]: !value }))
        setError(result.error)
      }
    })
  }

  const TOGGLES: { field: ToggleField; label: string; description: string }[] = [
    {
      field: 'notifyRfiEmail',
      label: 'RFI email notifications',
      description: 'Send an email to the project team when an RFI is raised, responded to, or closed on this project.',
    },
    {
      field: 'notifySnagEmail',
      label: 'Snag email notifications',
      description: 'Send an email to the project team when a snag is raised, its status changes, or it is signed off on this project.',
    },
    {
      field: 'notifyDiaryEmail',
      label: 'Site diary email notifications',
      description: 'Send an email to the project team for every site diary entry logged on this project.',
    },
    {
      field: 'notifyInspectionEmail',
      label: 'Inspection email notifications',
      description: 'Send an email when an inspection is scheduled or completed on this project.',
    },
  ]

  return (
    <Card>
      <CardHeader>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Notification toggles</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--c-text-mid)' }}>
          Email notifications for project activity. Changes save immediately.
        </p>
      </CardHeader>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {TOGGLES.map(({ field, label, description }) => (
            <label
              key={field}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                cursor: isPending ? 'wait' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={values[field]}
                disabled={isPending}
                onChange={e => toggle(field, e.target.checked)}
                style={{ marginTop: 2, accentColor: 'var(--c-amber)', width: 15, height: 15, flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
                  {label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 2 }}>
                  {description}
                </div>
              </div>
            </label>
          ))}

          {error && (
            <p style={{ fontSize: 12, color: 'var(--c-red)', margin: 0 }}>
              {error}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
