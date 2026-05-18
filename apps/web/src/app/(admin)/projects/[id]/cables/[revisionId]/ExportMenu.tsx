'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  projectId: string
  revisionId: string
}

interface MenuItem {
  label: string
  href: string
  emoji: string
  hint?: string
}

export function ExportMenu({ projectId, revisionId }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const qs = `?projectId=${encodeURIComponent(projectId)}&revisionId=${encodeURIComponent(revisionId)}`
  const projectQs = `?projectId=${encodeURIComponent(projectId)}`

  const items: MenuItem[] = [
    {
      label: 'All ISSUED revisions (ZIP)',
      href: `/api/cable-schedule/export/multi-zip${projectQs}`,
      emoji: '🗂',
      hint: 'Handover pack — every issued revision in one bundle',
    },
    {
      label: 'Revision pack (ZIP)',
      href: `/api/cable-schedule/export/zip${qs}`,
      emoji: '📦',
      hint: 'Everything: xlsx + pdf + 4 CSVs + README',
    },
    {
      label: 'Excel workbook',
      href: `/api/cable-schedule/export/excel${qs}`,
      emoji: '📊',
      hint: 'Round-trip safe — re-importable as a DRAFT',
    },
    {
      label: 'PDF revision pack',
      href: `/api/cable-schedule/export/pdf${qs}`,
      emoji: '📄',
      hint: 'Cover + schedule + cost + tags with QR',
    },
    {
      label: 'CSV — Schedule',
      href: `/api/cable-schedule/export/csv${qs}&type=schedule`,
      emoji: '📑',
    },
    {
      label: 'CSV — Tags',
      href: `/api/cable-schedule/export/csv${qs}&type=tags`,
      emoji: '🏷',
    },
    {
      label: 'CSV — Cost',
      href: `/api/cable-schedule/export/csv${qs}&type=cost`,
      emoji: '💰',
    },
    {
      label: 'CSV — Change log',
      href: `/api/cable-schedule/export/csv${qs}&type=change_log`,
      emoji: '📋',
    },
  ]

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-primary-amber"
        style={{
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          color: 'var(--c-text-mid)',
          cursor: 'pointer',
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        📥 Export {open ? '▴' : '▾'}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 280,
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 50,
            padding: 4,
          }}
        >
          {items.map((item, idx) => {
            // Dividers:
            //  • after idx 0 — separates the multi-revision pack from the
            //    per-revision options (the new T11 entry stands apart)
            //  • after idx 4 (= original idx 4 + 1 for the new top entry) —
            //    separates the "main" formats from the CSV granular options
            const showDivider = idx === 1 || idx === 5
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                role="menuitem"
                style={{
                  display: 'block',
                  padding: '10px 12px',
                  fontSize: 13,
                  color: 'var(--c-text)',
                  textDecoration: 'none',
                  borderRadius: 3,
                  borderTop: showDivider ? '1px solid var(--c-border)' : 'none',
                  marginTop: showDivider ? 4 : 0,
                  paddingTop: showDivider ? 12 : 10,
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLAnchorElement).style.background =
                    'var(--c-panel-hover, #2a2a2a)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLAnchorElement).style.background = ''
                }}
              >
                <span style={{ marginRight: 8 }}>{item.emoji}</span>
                <span style={{ fontWeight: idx < 4 ? 600 : 400 }}>{item.label}</span>
                {item.hint && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--c-text-dim)',
                      marginTop: 2,
                      marginLeft: 24,
                    }}
                  >
                    {item.hint}
                  </div>
                )}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
