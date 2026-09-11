'use client'

/**
 * Project notification toggles.
 *
 * ⚠ A CONTROL HERE IS A PROMISE. Every entry in TOGGLES must drive a column
 * something actually reads, and every notify_* boolean column must either
 * appear here or have a recorded reason for not appearing. A contract test
 * (notification-toggles.contract.test.ts) enforces both directions — this panel
 * accumulated four separate instances of a switch that controlled nothing.
 *
 * Removed: "Inspection email notifications". It wrote notify_inspection_email,
 * was surfaced as cfg.inspectionEmail, and had ZERO consumers anywhere. It was
 * switched on for (643) KINGSWALK on 2026-06-18 and sent nothing for twelve
 * weeks. It is not rebuilt here because the module's real events are
 * inspection_assigned / inspection_awaiting_verification / inspection_abandoned
 * — not the "scheduled or completed" the copy promised — so the events have to
 * be chosen and the copy written to them before a control can be honest. And
 * KINGSWALK's column is still true, so shipping a sender would start mailing
 * that project's whole roster on the next deploy with nobody re-consenting.
 *
 * Added: "Site form email notifications". notify_form_email defaults TRUE on
 * every project and mails the whole roster a SANS 10142-1 making-safe record
 * with inline photos — the highest-consequence email the platform sends — and
 * it had no control at all.
 */

import { useState, useTransition } from 'react'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { updateProjectSettingsAction } from '@/actions/project-settings.actions'

type ToggleField =
  | 'notifyRfiEmail'
  | 'notifySnagEmail'
  | 'notifyQcEmail'
  | 'notifyDiaryEmail'
  | 'notifyFormEmail'

interface Props {
  projectId: string
  initialNotifyRfiEmail: boolean
  initialNotifySnagEmail: boolean
  initialNotifyQcEmail: boolean
  initialNotifyDiaryEmail: boolean
  initialNotifyFormEmail: boolean
}

export function IntegrationsPanel({
  projectId,
  initialNotifyRfiEmail,
  initialNotifySnagEmail,
  initialNotifyQcEmail,
  initialNotifyDiaryEmail,
  initialNotifyFormEmail,
}: Props) {
  const [values, setValues] = useState<Record<ToggleField, boolean>>({
    notifyRfiEmail: initialNotifyRfiEmail,
    notifySnagEmail: initialNotifySnagEmail,
    notifyQcEmail: initialNotifyQcEmail,
    notifyDiaryEmail: initialNotifyDiaryEmail,
    notifyFormEmail: initialNotifyFormEmail,
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
      field: 'notifyQcEmail',
      label: 'QC report email notifications',
      description: 'Send an email to the project team when a quality control report is issued on this project.',
    },
    {
      field: 'notifyDiaryEmail',
      label: 'Site diary email notifications',
      description: 'Send an email to the project team for every site diary entry logged on this project.',
    },
    {
      field: 'notifyFormEmail',
      label: 'Site form email notifications',
      description:
        'Send the branded PDF to the project team when a site form (such as a Termination & Making Safe record) is distributed on this project. Turning this off leaves the in-app notification in place.',
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
