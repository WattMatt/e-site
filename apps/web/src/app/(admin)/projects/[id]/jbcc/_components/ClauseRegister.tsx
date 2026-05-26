'use client'

import type { JbccClause } from '@esite/shared'

interface Props { clauses: JbccClause[] }

export function ClauseRegister({ clauses }: Props) {
  return (
    <div style={{ padding: '40px 0 64px' }}>
      {/* Table container — 1px grid lines, no border-radius */}
      <div
        style={{
          border: '1px solid var(--c-border)',
          overflowX: 'auto',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--c-border)',
                background: 'var(--c-panel)',
              }}
            >
              {['Clause', 'Contract', 'Topic', 'Time-bar', 'Linked notice'].map(h => (
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
            {clauses.map((c, idx) => (
              <tr
                key={c.id}
                style={{
                  borderTop: idx > 0 ? '1px solid var(--c-border)' : undefined,
                  background: 'var(--c-surface)',
                }}
              >
                {/* Clause ref — mono, prominent */}
                <td
                  style={{
                    padding: '12px 16px',
                    fontFamily: 'var(--f-mono-display)',
                    fontSize: 12,
                    color: 'var(--c-text)',
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.clause_ref}
                </td>
                {/* Contract — muted mono */}
                <td
                  style={{
                    padding: '12px 16px',
                    fontFamily: 'var(--f-mono-display)',
                    fontSize: 11,
                    color: 'var(--c-text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.contract}
                </td>
                {/* Topic — Fraunces italic for the serif editorial feel */}
                <td
                  style={{
                    padding: '12px 16px',
                    fontFamily: 'var(--f-display)',
                    fontStyle: 'italic',
                    fontWeight: 350,
                    fontSize: 15,
                    color: 'var(--c-text)',
                    maxWidth: 320,
                  }}
                >
                  {c.topic}
                </td>
                {/* Time-bar — muted body */}
                <td
                  style={{
                    padding: '12px 16px',
                    fontSize: 12,
                    color: 'var(--c-text-muted)',
                    maxWidth: 200,
                  }}
                >
                  {c.time_bar ?? '—'}
                </td>
                {/* Linked notice — amber mono if present */}
                <td
                  style={{
                    padding: '12px 16px',
                    fontFamily: 'var(--f-mono-display)',
                    fontSize: 11,
                    color: c.linked_notice ? 'var(--c-amber)' : 'var(--c-text-muted)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {c.linked_notice ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
