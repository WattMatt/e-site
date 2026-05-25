'use client'

import type { JbccTimeBar } from '@esite/shared'

interface Props { timebars: JbccTimeBar[] }

export function TimeBarSchedule({ timebars }: Props) {
  return (
    <div style={{ padding: '40px 0 64px' }}>
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
              {['Clause', 'Period', 'Parties', 'Required action'].map(h => (
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
            {timebars.map((t, idx) => (
              <tr
                key={t.id}
                style={{
                  borderTop: idx > 0 ? '1px solid var(--c-border)' : undefined,
                  background: 'var(--c-surface)',
                }}
              >
                {/* Clause — mono amber to echo notice codes */}
                <td
                  style={{
                    padding: '12px 16px',
                    fontFamily: 'var(--f-mono-display)',
                    fontSize: 12,
                    color: 'var(--c-amber)',
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.clause}
                </td>
                {/* Period — mono, prominent */}
                <td
                  style={{
                    padding: '12px 16px',
                    fontFamily: 'var(--f-mono-display)',
                    fontSize: 12,
                    color: 'var(--c-text)',
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.02em',
                  }}
                >
                  {t.time_period}
                </td>
                {/* Parties — muted body */}
                <td
                  style={{
                    padding: '12px 16px',
                    fontSize: 12,
                    color: 'var(--c-text-muted)',
                    maxWidth: 180,
                  }}
                >
                  {t.parties}
                </td>
                {/* Action — Fraunces italic for editorial weight */}
                <td
                  style={{
                    padding: '12px 16px',
                    fontFamily: 'var(--f-display)',
                    fontStyle: 'italic',
                    fontWeight: 350,
                    fontSize: 15,
                    color: 'var(--c-text)',
                    lineHeight: 1.4,
                  }}
                >
                  {t.action}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
