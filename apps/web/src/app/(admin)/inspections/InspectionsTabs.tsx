import Link from 'next/link'
import type { CSSProperties } from 'react'

const TAB_BASE: CSSProperties = {
  padding: '6px 16px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  border: '1px solid var(--c-border)',
  borderRadius: 4,
  letterSpacing: '0.04em',
  textDecoration: 'none',
  display: 'inline-block',
}

const TAB_ACTIVE: CSSProperties = {
  ...TAB_BASE,
  background: 'var(--c-panel)',
  color: 'var(--c-text)',
  borderColor: 'var(--c-text-dim)',
}

const TAB_INACTIVE: CSSProperties = {
  ...TAB_BASE,
  color: 'var(--c-text-dim)',
}

/** Tab bar for the org-wide inspections area — instance rollup vs. template library. */
export function InspectionsTabs({ active }: { active: 'inspections' | 'templates' }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
      <Link href="/inspections" style={active === 'inspections' ? TAB_ACTIVE : TAB_INACTIVE}>
        Inspections
      </Link>
      <Link
        href="/inspections/templates"
        style={active === 'templates' ? TAB_ACTIVE : TAB_INACTIVE}
      >
        Templates
      </Link>
    </div>
  )
}
