'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import {
  bulkAddOrInviteProjectMembers,
  type BulkAddResult,
  type BulkAddStatus,
} from '@/actions/project-members-bulk.actions'

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
}

const PROJECT_MEMBER_ROLES = [
  'project_manager',
  'contractor',
  'inspector',
  'supplier',
  'client_viewer',
] as const

const ROLE_LABEL: Record<string, string> = {
  project_manager: 'Project Manager',
  contractor:      'Contractor',
  inspector:       'Inspector',
  supplier:        'Supplier',
  client_viewer:   'Client (read-only)',
}

const STATUS_LABEL: Record<BulkAddStatus, string> = {
  'added':                      'Added',
  'invited-and-added':          'Invited + added',
  'skipped-already-on-project': 'Skipped (already on project)',
  'failed':                     'Failed',
}

const STATUS_COLOR: Record<BulkAddStatus, string> = {
  'added':                      'var(--c-green)',
  'invited-and-added':          'var(--c-blue)',
  'skipped-already-on-project': 'var(--c-text-dim)',
  'failed':                     'var(--c-danger)',
}

export function BulkAddMembersModal({ projectId, open, onClose }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [emailsText, setEmailsText] = useState('')
  const [role, setRole] = useState<string>('contractor')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkAddResult | null>(null)

  if (!open) return null

  function reset() {
    setEmailsText('')
    setRole('contractor')
    setError(null)
    setResult(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleSubmit() {
    setError(null)
    const emails = emailsText
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0)
    if (emails.length === 0) {
      setError('Paste at least one email address.')
      return
    }
    startTransition(async () => {
      const r = await bulkAddOrInviteProjectMembers({
        projectId,
        emails,
        projectRole: role,
      })
      if (!r.ok) {
        setError(r.error)
        return
      }
      setResult(r)
      router.refresh()
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-add-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        style={{
          width: 'min(560px, 95vw)', maxHeight: '90vh', overflow: 'auto',
          background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8,
          boxShadow: '0 14px 40px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--c-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 id="bulk-add-title" style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}>
            Bulk add members
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', color: 'var(--c-text-dim)',
              fontSize: 18, cursor: 'pointer', padding: 4,
            }}
          >×</button>
        </div>

        <div style={{ padding: 18 }}>
          {result ? (
            <BulkSummary result={result} onDone={handleClose} />
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 12 }}>
                Paste email addresses (one per line, or comma/semicolon separated). Existing org users
                are added directly. New emails get an org invite + are added to this project.
              </p>

              <div style={{ marginBottom: 14 }}>
                <label
                  htmlFor="bulk-emails"
                  style={{
                    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: 'var(--c-text-dim)', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 4,
                  }}
                >
                  Emails
                </label>
                <textarea
                  id="bulk-emails"
                  value={emailsText}
                  onChange={(e) => setEmailsText(e.target.value)}
                  disabled={isPending}
                  rows={6}
                  placeholder="agent1@bobsbuilding.co.za&#10;agent2@bobsbuilding.co.za&#10;..."
                  style={{
                    width: '100%', padding: '8px 10px',
                    fontSize: 13, fontFamily: 'var(--font-mono)',
                    border: '1px solid var(--c-border)', borderRadius: 4,
                    background: 'var(--c-input-bg)', color: 'var(--c-text)',
                    resize: 'vertical', minHeight: 120,
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label
                    htmlFor="bulk-role"
                    style={{
                      display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
                      color: 'var(--c-text-dim)', letterSpacing: '0.08em',
                      textTransform: 'uppercase', marginBottom: 4,
                    }}
                  >
                    Project role
                  </label>
                  <select
                    id="bulk-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={isPending}
                    style={{
                      width: '100%', padding: '8px 10px', fontSize: 13,
                      border: '1px solid var(--c-border)', borderRadius: 4,
                      background: 'var(--c-input-bg)', color: 'var(--c-text)',
                    }}
                  >
                    {PROJECT_MEMBER_ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {role === 'project_manager' && (
                <div style={{
                  padding: '8px 12px', fontSize: 11, color: 'var(--c-text-mid)',
                  background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber)',
                  borderRadius: 4, marginBottom: 14,
                }}>
                  Project-manager role on this project only. New users get org role
                  'contractor' so the PM promotion stays scoped — they won't see other projects.
                </div>
              )}

              {error && (
                <div style={{
                  padding: '8px 12px', fontSize: 12, color: 'var(--c-danger)',
                  background: 'var(--c-danger-dim)', border: '1px solid var(--c-danger)',
                  borderRadius: 4, marginBottom: 14,
                }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <Button onClick={handleClose} disabled={isPending} variant="ghost">Cancel</Button>
                <Button onClick={handleSubmit} disabled={isPending || !emailsText.trim()} isLoading={isPending}>
                  Add / invite
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function BulkSummary({ result, onDone }: { result: BulkAddResult; onDone: () => void }) {
  const { summary, details } = result
  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 8, marginBottom: 16,
      }}>
        {[
          ['Invited', summary.invited],
          ['Added',   summary.added],
          ['Skipped', summary.skipped],
          ['Failed',  summary.failed],
        ].map(([label, n]) => (
          <div
            key={String(label)}
            style={{
              padding: '10px 12px', background: 'var(--c-elevated)',
              border: '1px solid var(--c-border)', borderRadius: 4,
              textAlign: 'center',
            }}
          >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--c-text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)', marginTop: 2 }}>
              {n as number}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        maxHeight: 240, overflow: 'auto',
        border: '1px solid var(--c-border)', borderRadius: 4,
        marginBottom: 16,
      }}>
        {details.map((d, i) => (
          <div
            key={`${d.email}-${i}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px',
              borderTop: i === 0 ? 'none' : '1px solid var(--c-border)',
              fontSize: 12,
            }}
          >
            <span style={{ flex: 1, fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>
              {d.email}
            </span>
            <span style={{ color: STATUS_COLOR[d.status], fontWeight: 600, fontSize: 11 }}>
              {STATUS_LABEL[d.status]}
            </span>
            {d.reason && (
              <span style={{ color: 'var(--c-text-dim)', fontSize: 10, maxWidth: 200, textAlign: 'right' }}>
                {d.reason}
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
