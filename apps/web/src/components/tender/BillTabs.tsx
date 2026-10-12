'use client'

import { useRef, type KeyboardEvent } from 'react'

export interface BillTab {
  /** The sheet name as imported, e.g. "C - Reticulation". */
  key: string
  /** Bidder: how many items of this bill have an answer. */
  progress?: { done: number; total: number }
  /** A short second line, e.g. "6 items" or "R 12 500.00". */
  note?: string
}

/** "C - Reticulation" → { code: 'C', name: 'Reticulation' }; anything else keeps its whole name. */
export function splitBillName(sheet: string): { code: string | null; name: string } {
  const m = /^\s*([A-Z0-9]{1,3})\s*[-–—:.]\s*(.+)$/i.exec(sheet)
  return m ? { code: m[1].toUpperCase(), name: m[2].trim() } : { code: null, name: sheet.trim() }
}

/**
 * The bills of a BOQ as tabs: a lettered badge, the bill's name and, for a
 * bidder, how far it is priced. One row that scrolls sideways on a phone;
 * arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
 */
export function BillTabs({
  tabs,
  active,
  onSelect,
  label,
  panelId,
}: {
  tabs: BillTab[]
  active: string
  onSelect: (key: string) => void
  label: string
  panelId: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = Math.max(0, tabs.findIndex((t) => t.key === active))

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = tabs.length - 1
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next == null) return
    e.preventDefault()
    onSelect(tabs[next].key)
    refs.current[next]?.focus()
  }

  return (
    <div className="bill-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => {
        const { code, name } = splitBillName(t.key)
        const selected = t.key === active
        const complete = !!t.progress && t.progress.total > 0 && t.progress.done >= t.progress.total
        const pct = t.progress && t.progress.total > 0 ? Math.round((t.progress.done / t.progress.total) * 100) : 0
        return (
          <button
            key={t.key}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            id={`${panelId}-tab-${i}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className={`bill-tab${selected ? ' is-active' : ''}${complete ? ' is-complete' : ''}`}
            aria-label={[t.key, t.progress && t.progress.total > 0 ? (complete ? 'all priced' : `${t.progress.done} of ${t.progress.total} priced`) : null, t.note].filter(Boolean).join(', ')}
            onClick={() => onSelect(t.key)}
          >
            <span className="bill-tab-head">
              {code && <span className="bill-tab-code" aria-hidden="true">{code}</span>}
              <span className="bill-tab-name">{name}</span>
            </span>
            {t.progress && t.progress.total > 0 && (
              <>
                <span className="bill-tab-note">
                  {complete ? '✓ All priced' : `${t.progress.done} of ${t.progress.total} priced`}
                </span>
                <span className="bill-tab-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
              </>
            )}
            {t.note && <span className="bill-tab-note">{t.note}</span>}
          </button>
        )
      })}
    </div>
  )
}
