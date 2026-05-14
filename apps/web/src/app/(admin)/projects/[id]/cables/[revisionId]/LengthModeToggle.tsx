'use client'

import React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export type LengthMode = 'design' | 'as-built' | 'worst'

const MODES: Array<{ key: LengthMode; label: string; title: string }> = [
  { key: 'design',   label: 'Design',     title: 'Use measured lengths everywhere — tender / budget basis' },
  { key: 'as-built', label: 'As-built',   title: 'Use confirmed lengths where signed off, measured otherwise — default' },
  { key: 'worst',    label: 'Worst-case', title: 'Use max(measured, confirmed) per cable — engineer compliance buffer' },
]

export function LengthModeToggle({
  basePath,
  current,
  hasConfirmedLengths,
}: {
  basePath: string
  current: LengthMode
  hasConfirmedLengths: boolean
}) {
  const params = useSearchParams()

  function hrefFor(mode: LengthMode): string {
    const sp = new URLSearchParams(params.toString())
    if (mode === 'as-built') sp.delete('view')
    else sp.set('view', mode)
    const qs = sp.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--c-text-dim)',
      }}>
        Lengths
      </span>
      <div
        role="tablist"
        aria-label="Length-source view"
        title={hasConfirmedLengths ? undefined : 'Available once cables have site-confirmed lengths'}
        style={{
          display: 'inline-flex',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          overflow: 'hidden',
          opacity: hasConfirmedLengths ? 1 : 0.5,
        }}
      >
        {MODES.map((m) => {
          const active = current === m.key
          const shared: React.CSSProperties = {
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '7px 14px',
            textDecoration: 'none',
            borderRight: '1px solid var(--c-border)',
            color: active ? '#0D0B09' : 'var(--c-text-mid)',
            background: active ? 'var(--c-amber)' : 'var(--c-panel)',
          }
          if (!hasConfirmedLengths) {
            return (
              <span key={m.key} role="tab" aria-selected={active} aria-disabled="true"
                style={{ ...shared, cursor: 'not-allowed' }}>
                {m.label}
              </span>
            )
          }
          return (
            <Link key={m.key} href={hrefFor(m.key)} role="tab" aria-selected={active}
              title={m.title} scroll={false} style={shared}>
              {m.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
