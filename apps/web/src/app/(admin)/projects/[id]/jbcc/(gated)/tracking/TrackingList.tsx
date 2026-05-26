'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { deadlineStatus, type JbccLetter, type JbccNotice, type DeadlineStatus } from '@esite/shared'

interface Props {
  projectId: string
  letters: JbccLetter[]
  noticeById: Record<string, JbccNotice>
}

// Deadline chip classes (from globals.css jbcc-chip variants)
const DEADLINE_CHIP: Record<DeadlineStatus, { label: string; cls: string }> = {
  clear:       { label: 'On track', cls: 'jbcc-chip jbcc-chip--clear' },
  due_soon:    { label: 'Due soon', cls: 'jbcc-chip jbcc-chip--due-soon' },
  overdue:     { label: 'Overdue',  cls: 'jbcc-chip jbcc-chip--overdue' },
  no_deadline: { label: 'See rule', cls: 'jbcc-chip jbcc-chip--none' },
}

// Letter status chip classes
const STATUS_CHIP: Record<JbccLetter['status'], string> = {
  draft:  'jbcc-chip jbcc-status-draft',
  issued: 'jbcc-chip jbcc-status-issued',
  served: 'jbcc-chip jbcc-status-served',
}

export function TrackingList({ projectId, letters, noticeById }: Props) {
  const today = useMemo(() => {
    const d = new Date()
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }, [])

  if (letters.length === 0) {
    return (
      <div
        style={{
          padding: '64px 24px',
          textAlign: 'center',
          fontFamily: 'var(--f-mono-display)',
          fontSize: 12,
          color: 'var(--c-text-muted)',
          letterSpacing: '0.06em',
          border: '1px dashed var(--c-border)',
          margin: '40px 0',
        }}
      >
        No letters generated yet — open a notice from the library to start
      </div>
    )
  }

  return (
    <div
      className="jbcc-page-fade"
      style={{ maxWidth: 1060, margin: '0 auto', padding: '48px 40px 96px' }}
    >
      {/* Page header */}
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            fontFamily: 'var(--f-mono-display)',
            fontSize: 10,
            letterSpacing: '0.22em',
            color: 'var(--c-amber)',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Correspondence Tracking
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontWeight: 350,
            fontSize: 36,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: 'var(--c-text)',
            margin: '0 0 14px',
          }}
        >
          Letters
        </h1>
        <p
          style={{
            fontFamily: 'var(--f-mono-display)',
            fontSize: 11,
            color: 'var(--c-text-muted)',
            letterSpacing: '0.04em',
            borderTop: '1px solid var(--c-border)',
            paddingTop: 14,
          }}
        >
          {letters.length} {letters.length === 1 ? 'letter' : 'letters'} ·{' '}
          {letters.filter(l => l.status !== 'served').length} open
        </p>
      </div>

      {/* Table — 1px-border, no radius */}
      <div style={{ border: '1px solid var(--c-border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--c-panel)', borderBottom: '1px solid var(--c-border)' }}>
              {['Notice', 'Status', 'Trigger', 'Deadline', ''].map(h => (
                <th
                  key={h}
                  style={{
                    padding: '10px 16px',
                    fontFamily: 'var(--f-mono-display)',
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'var(--c-text-muted)',
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {letters.map((l, idx) => {
              const notice = noticeById[l.notice_id]
              const deadline = l.deadline_date ? new Date(`${l.deadline_date}T00:00:00.000Z`) : null
              const ds = deadlineStatus(deadline, today)
              const dlChip = DEADLINE_CHIP[ds]

              return (
                <tr
                  key={l.id}
                  style={{
                    borderTop: idx > 0 ? '1px solid var(--c-border)' : undefined,
                    background: 'var(--c-surface)',
                  }}
                >
                  {/* Notice code + title */}
                  <td style={{ padding: '14px 16px' }}>
                    <div
                      style={{
                        fontFamily: 'var(--f-mono-display)',
                        fontSize: 10,
                        color: 'var(--c-amber)',
                        letterSpacing: '0.10em',
                        marginBottom: 4,
                      }}
                    >
                      {notice?.code ?? '—'}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--f-display)',
                        fontStyle: 'italic',
                        fontWeight: 350,
                        fontSize: 15,
                        color: 'var(--c-text)',
                        lineHeight: 1.3,
                      }}
                    >
                      {notice?.title ?? 'Unknown notice'}
                    </div>
                  </td>

                  {/* Status chip */}
                  <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                    <span className={STATUS_CHIP[l.status]}>
                      {l.status}
                    </span>
                  </td>

                  {/* Trigger date */}
                  <td
                    style={{
                      padding: '14px 16px',
                      fontFamily: 'var(--f-mono-display)',
                      fontSize: 11,
                      color: 'var(--c-text-muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {l.trigger_date ?? '—'}
                  </td>

                  {/* Deadline + chip */}
                  <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {l.deadline_date && (
                        <span
                          style={{
                            fontFamily: 'var(--f-mono-display)',
                            fontSize: 11,
                            color: ds === 'overdue' ? 'var(--c-red-bright)' : 'var(--c-text-muted)',
                          }}
                        >
                          {l.deadline_date}
                        </span>
                      )}
                      <span className={dlChip.cls}>
                        {dlChip.label}
                      </span>
                    </div>
                  </td>

                  {/* Open link */}
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <Link
                      href={`/projects/${projectId}/jbcc/tracking/${l.id}`}
                      style={{
                        fontFamily: 'var(--f-mono-display)',
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'var(--c-amber)',
                        textDecoration: 'none',
                        opacity: 0.7,
                        transition: 'opacity .15s',
                      }}
                      className="jbcc-tracking-open"
                    >
                      Open ↗
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
