'use client'

import { useState, useTransition } from 'react'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { updateProjectSettingsAction } from '@/actions/project-settings.actions'

interface Props {
  projectId: string
  initialNotifyRfiEmail: boolean
  initialNotifyInspectionEmail: boolean
}

export function IntegrationsPanel({
  projectId,
  initialNotifyRfiEmail,
  initialNotifyInspectionEmail,
}: Props) {
  const [notifyRfiEmail, setNotifyRfiEmail] = useState(initialNotifyRfiEmail)
  const [notifyInspectionEmail, setNotifyInspectionEmail] = useState(initialNotifyInspectionEmail)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function toggle(field: 'notifyRfiEmail' | 'notifyInspectionEmail', value: boolean) {
    if (field === 'notifyRfiEmail') setNotifyRfiEmail(value)
    else setNotifyInspectionEmail(value)
    setError(null)
    startTransition(async () => {
      const result = await updateProjectSettingsAction(projectId, { [field]: value })
      if ('error' in result) {
        // Roll back optimistic update
        if (field === 'notifyRfiEmail') setNotifyRfiEmail(!value)
        else setNotifyInspectionEmail(!value)
        setError(result.error)
      }
    })
  }

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
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              cursor: isPending ? 'wait' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={notifyRfiEmail}
              disabled={isPending}
              onChange={e => toggle('notifyRfiEmail', e.target.checked)}
              style={{ marginTop: 2, accentColor: 'var(--c-amber)', width: 15, height: 15, flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
                RFI email notifications
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 2 }}>
                Send an email when a new RFI is created or updated on this project.
              </div>
            </div>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              cursor: isPending ? 'wait' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={notifyInspectionEmail}
              disabled={isPending}
              onChange={e => toggle('notifyInspectionEmail', e.target.checked)}
              style={{ marginTop: 2, accentColor: 'var(--c-amber)', width: 15, height: 15, flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
                Inspection email notifications
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 2 }}>
                Send an email when an inspection is scheduled or completed on this project.
              </div>
            </div>
          </label>

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
