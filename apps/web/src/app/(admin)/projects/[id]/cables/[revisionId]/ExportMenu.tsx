'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  projectId: string
  revisionId: string
  /**
   * T12 — optional pre-encoded filter querystring to append to CSV
   * links. Example: `&filter=panel&size=70,95&conductor=CU`. Excel /
   * PDF / ZIP exports do NOT honour this yet (deferred), so the
   * suffix is intentionally only appended to CSV variants — appending
   * to other formats would silently mislead the user.
   *
   * Caller is responsible for URL-encoding values + including the
   * leading `&`.
   */
  filterQuery?: string
}

interface MenuItem {
  label: string
  href: string
  emoji: string
  hint?: string
  /** Fallback filename used when the response has no Content-Disposition. */
  fallbackFilename: string
}

/**
 * Programmatic fetch + Blob download. `<a download>` silently discards
 * non-2xx responses (auth redirects, 4xx, 5xx) — a failed export looks
 * indistinguishable from a successful one to the user. fetch + status
 * check surfaces the actual response so server-side errors become
 * visible instead of "nothing happens".
 *
 * Mirrors the pattern in `tags/TagControls.tsx` (commit 55e9e0a).
 */
async function downloadFromUrl(
  url: string,
  fallbackFilename: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) {
      let detail = ''
      try {
        const text = await r.text()
        detail = text.length > 120 ? text.slice(0, 120) + '…' : text
      } catch {
        detail = r.statusText
      }
      return { ok: false, error: `Download failed (HTTP ${r.status}): ${detail || r.statusText}` }
    }
    const blob = await r.blob()
    if (blob.size === 0) {
      return { ok: false, error: 'Download failed: server returned an empty file' }
    }
    const cd = r.headers.get('content-disposition') ?? ''
    const match = /filename="([^"]+)"/.exec(cd)
    const filename = match?.[1] ?? fallbackFilename

    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(blobUrl)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Download failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export function ExportMenu({ projectId, revisionId, filterQuery }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadingHref, setDownloadingHref] = useState<string | null>(null)
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
  const revStem = revisionId.slice(0, 8)

  const items: MenuItem[] = [
    {
      label: 'All ISSUED revisions (ZIP)',
      href: `/api/cable-schedule/export/multi-zip${projectQs}`,
      emoji: '🗂',
      hint: 'Handover pack — every issued revision in one bundle',
      fallbackFilename: `cable-schedule-all-issued-${projectId.slice(0, 8)}.zip`,
    },
    {
      label: 'Revision pack (ZIP)',
      href: `/api/cable-schedule/export/zip${qs}`,
      emoji: '📦',
      hint: 'Everything: xlsx + pdf + 4 CSVs + README',
      fallbackFilename: `cable-schedule-${revStem}.zip`,
    },
    {
      label: 'Excel workbook',
      href: `/api/cable-schedule/export/excel${qs}`,
      emoji: '📊',
      hint: 'Round-trip safe — re-importable as a DRAFT',
      fallbackFilename: `cable-schedule-${revStem}.xlsx`,
    },
    {
      label: 'PDF revision pack',
      href: `/api/cable-schedule/export/pdf${qs}`,
      emoji: '📄',
      hint: 'Cover + schedule + cost + tags with QR',
      fallbackFilename: `cable-schedule-${revStem}.pdf`,
    },
    {
      label: 'Tag labels (Avery L7173)',
      href: `/api/cable-schedule/export/tag-labels/pdf${qs}`,
      emoji: '🏷',
      hint: '4×10 A4 sheet — peel-and-stick cable tags',
      fallbackFilename: `cable-tag-labels-${revStem}.pdf`,
    },
    // T12: CSV variants honour the optional filterQuery. change_log
    // intentionally drops it — the route ignores filter params for
    // change_log (audit trail isn't cable-scoped), but keeping the
    // suffix off the link avoids URLs that look like they'd filter.
    {
      label: 'CSV — Schedule',
      href: `/api/cable-schedule/export/csv${qs}&type=schedule${filterQuery ?? ''}`,
      emoji: '📑',
      fallbackFilename: `cable-schedule-${revStem}.csv`,
    },
    {
      label: 'CSV — Tags',
      href: `/api/cable-schedule/export/csv${qs}&type=tags${filterQuery ?? ''}`,
      emoji: '🏷',
      fallbackFilename: `cable-tags-${revStem}.csv`,
    },
    {
      label: 'CSV — Cost',
      href: `/api/cable-schedule/export/csv${qs}&type=cost${filterQuery ?? ''}`,
      emoji: '💰',
      fallbackFilename: `cable-cost-${revStem}.csv`,
    },
    {
      label: 'CSV — Change log',
      href: `/api/cable-schedule/export/csv${qs}&type=change_log`,
      emoji: '📋',
      fallbackFilename: `cable-change-log-${revStem}.csv`,
    },
  ]

  async function handleClick(item: MenuItem) {
    setError(null)
    setDownloadingHref(item.href)
    try {
      const result = await downloadFromUrl(item.href, item.fallbackFilename)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
    } finally {
      setDownloadingHref(null)
    }
  }

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
            //    per-revision options
            //  • after idx 4 — separates the "main" formats (zip / xlsx /
            //    pdf / tag labels) from the CSV granular options. The new
            //    Tag-labels entry slots into the main-formats block, so
            //    the divider stays at idx 4 → triggers after the 5th
            //    main-format row (idx 5 onwards is CSVs).
            const showDivider = idx === 1 || idx === 5
            const isDownloading = downloadingHref === item.href
            const anyDownloading = downloadingHref !== null
            return (
              <button
                key={item.href}
                type="button"
                disabled={anyDownloading}
                onClick={() => handleClick(item)}
                role="menuitem"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  padding: '10px 12px',
                  fontSize: 13,
                  color: 'var(--c-text)',
                  cursor: anyDownloading ? 'wait' : 'pointer',
                  opacity: anyDownloading && !isDownloading ? 0.5 : 1,
                  borderRadius: 3,
                  borderTop: showDivider ? '1px solid var(--c-border)' : 'none',
                  marginTop: showDivider ? 4 : 0,
                  paddingTop: showDivider ? 12 : 10,
                  font: 'inherit',
                }}
                onMouseEnter={(e) => {
                  if (anyDownloading) return
                  ;(e.currentTarget as HTMLButtonElement).style.background =
                    'var(--c-panel-hover, #2a2a2a)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                <span style={{ marginRight: 8 }}>{item.emoji}</span>
                <span style={{ fontWeight: idx < 5 ? 600 : 400 }}>
                  {item.label}
                  {isDownloading && ' — downloading…'}
                </span>
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
              </button>
            )
          })}
          {error && (
            <div
              role="alert"
              style={{
                marginTop: 6,
                padding: '8px 12px',
                fontSize: 11,
                color: 'var(--c-red)',
                borderTop: '1px solid var(--c-border)',
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
