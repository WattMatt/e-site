'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import {
  bulkInviteSubOrgMembers,
  type BulkSubOrgResult,
  type BulkSubOrgStatus,
} from '@/actions/sub-org-members.actions'

interface Props {
  subOrgId: string
  open:     boolean
  onClose:  () => void
}

const SUB_ORG_ROLES = [
  'contractor',
  'inspector',
  'supplier',
  'project_manager',
  'client_viewer',
] as const

const ROLE_LABEL: Record<string, string> = {
  contractor:      'Contractor',
  inspector:       'Inspector',
  supplier:        'Supplier',
  project_manager: 'Project Manager',
  client_viewer:   'Client (read-only)',
}

const STATUS_LABEL: Record<BulkSubOrgStatus, string> = {
  'invited':                   'Invited',
  'added':                     'Added',
  'invited-email-failed':      'Added — email failed',
  'skipped-already-in-sub-org': 'Skipped (already in roster)',
  'failed':                    'Failed',
}

const STATUS_COLOR: Record<BulkSubOrgStatus, string> = {
  'invited':                   'var(--c-blue)',
  'added':                     'var(--c-green)',
  'invited-email-failed':      'var(--c-amber)',
  'skipped-already-in-sub-org': 'var(--c-text-dim)',
  'failed':                    'var(--c-danger)',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 4,
}

export function SubOrgBulkInviteModal({ subOrgId, open, onClose }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [emailsText, setEmailsText] = useState('')
  const [role, setRole] = useState<string>('contractor')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkSubOrgResult | null>(null)

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
      const r = await bulkInviteSubOrgMembers({ subOrgId, emails, role })
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
      aria-labelledby="bulk-suborg-title"
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
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          width: '100%',
          maxWidth: 520,
          boxShadow: '0 14px 40px rgba(0,0,0,0.55)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--c-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2
            id="bulk-suborg-title"
            style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}
          >
            Bulk invite to roster
          </h2>
          <button
            onClick={handleClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--c-text-dim)', fontSize: 18, lineHeight: 1, padding: 2,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18 }}>
          {result ? (
            <BulkSummary result={result} onDone={handleClose} />
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 12 }}>
                Paste email addresses (one per line, or comma / semicolon separated). Existing users
                are added directly. Each person is emailed a branded invite that names you and this
                company with a link to set their password — so it doesn’t look like spam. They’re
                joining this contractor company; add them to specific sites afterwards.
              </p>

              <div style={{ marginBottom: 14 }}>
                <label htmlFor="bulk-suborg-emails" style={labelStyle}>Emails</label>
                <textarea
                  id="bulk-suborg-emails"
                  value={emailsText}
                  onChange={(e) => setEmailsText(e.target.value)}
                  disabled={isPending}
                  rows={6}
                  placeholder={'agent1@bobsbuilding.co.za\nagent2@bobsbuilding.co.za\n...'}
                  style={{
                    width: '100%', padding: '8px 10px', fontSize: 13,
                    border: '1px solid var(--c-border)', borderRadius: 4,
                    background: 'var(--c-input-bg)', color: 'var(--c-text)',
                    fontFamily: 'var(--font-mono)',
                    resize: 'vertical', minHeight: 120,
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label htmlFor="bulk-suborg-role" style={labelStyle}>Role</label>
                  <select
                    id="bulk-suborg-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={isPending}
                    style={{
                      width: '100%', padding: '8px 10px', fontSize: 13,
                      border: '1px solid var(--c-border)', borderRadius: 4,
                      background: 'var(--c-input-bg)', color: 'var(--c-text)',
                    }}
                  >
                    {SUB_ORG_ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div style={{
                  padding: '8px 12px', marginBottom: 12, fontSize: 12,
                  color: 'var(--c-danger)', background: 'var(--c-danger-dim)',
                  border: '1px solid var(--c-danger)', borderRadius: 4,
                }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <Button onClick={handleClose} disabled={isPending} variant="ghost">Cancel</Button>
                <Button
                  onClick={handleSubmit}
                  disabled={isPending || !emailsText.trim()}
                  isLoading={isPending}
                >
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

function BulkSummary({ result, onDone }: { result: BulkSubOrgResult; onDone: () => void }) {
  const { summary, details } = result
  const tiles: Array<[string, number]> = [
    ['Invited', summary.invited],
    ['Added',   summary.added],
    ['Skipped', summary.skipped],
    ['Failed',  summary.failed],
  ]
  if (summary.emailFailed > 0) tiles.push(['Email failed', summary.emailFailed])
  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
        gap: 8, marginBottom: 16,
      }}>
        {tiles.map(([label, n]) => (
          <div
            key={String(label)}
            style={{
              padding: '10px 12px', background: 'var(--c-elevated)',
              border: '1px solid var(--c-border)', borderRadius: 4,
              textAlign: 'center',
            }}
          >
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              color: 'var(--c-text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
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

      {summary.emailFailed > 0 && (
        <div style={{
          padding: '8px 12px', fontSize: 11, color: 'var(--c-text-mid)',
          background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber)',
          borderRadius: 4, marginBottom: 16,
        }}>
          {summary.emailFailed === 1
            ? '1 invite email failed to send.'
            : `${summary.emailFailed} invite emails failed to send.`}{' '}
          The people were added to the roster — removing and re-adding a member
          here sends them a fresh invite email.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
