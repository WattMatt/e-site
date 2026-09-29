'use client'
/**
 * Solar tab bar (spec §0.3). Built tabs are links; unbuilt tabs render
 * disabled with "Coming in a later phase" — their routes do not exist.
 * Tariff + Financials only at Edit + financials; Operations hidden (D-12).
 * No auto-save on tab change: with unsaved changes, an inline
 * "Discard unsaved changes?" replaces navigation (never window.confirm).
 */
import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { visibleSolarTabs, type ReadinessStep, type SolarAccessLevel } from '@esite/shared'
import { isSolarDirty, setSolarDirty } from '@/lib/solar/dirty-store'
import { StatusDot } from './StatusDot'

const TAB: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: '8px 12px', fontSize: 13,
  color: 'var(--c-text-mid)', textDecoration: 'none', borderBottom: '2px solid transparent',
}
const ACTIVE: CSSProperties = { color: 'var(--c-text)', borderBottomColor: 'var(--c-amber)' }

export function SolarTabBar({
  projectId,
  level,
  readiness,
}: {
  projectId: string
  level: SolarAccessLevel
  readiness: ReadinessStep[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const bySlug = new Map<string, ReadinessStep>(readiness.map((s) => [s.slug, s]))

  return (
    <div>
      <nav aria-label="Solar steps" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: '1px solid var(--c-border)' }}>
        {visibleSolarTabs(level).map((tab) => {
          const href = `/projects/${projectId}/solar/${tab.slug}`
          const active = pathname === href || pathname.startsWith(href + '/')
          const step = bySlug.get(tab.slug)
          const dot = step ? <StatusDot status={step.status} reason={step.reason} /> : null
          if (!tab.built) {
            return (
              <span key={tab.slug} aria-disabled="true" title="Coming in a later phase" style={{ ...TAB, opacity: 0.55, cursor: 'not-allowed' }}>
                {dot}{tab.label}
              </span>
            )
          }
          return (
            <Link
              key={tab.slug}
              href={href}
              aria-current={active ? 'page' : undefined}
              style={{ ...TAB, ...(active ? ACTIVE : {}) }}
              onClick={(e) => {
                if (!active && isSolarDirty()) {
                  e.preventDefault()
                  setPendingHref(href)
                }
              }}
            >
              {dot}{tab.label}
            </Link>
          )
        })}
      </nav>
      {pendingHref && (
        <div
          role="alertdialog"
          aria-label="Discard unsaved changes?"
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 12px', border: '1px solid var(--c-amber-mid)', background: 'var(--c-amber-dim)', borderRadius: 6, fontSize: 13 }}
        >
          <span>Discard unsaved changes?</span>
          <button
            type="button"
            onClick={() => {
              const target = pendingHref
              setSolarDirty(false)
              setPendingHref(null)
              router.push(target)
            }}
          >
            Discard
          </button>
          <button type="button" onClick={() => setPendingHref(null)}>Stay</button>
        </div>
      )}
    </div>
  )
}
