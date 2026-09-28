'use client'
/** "View source" (spec §5, §12): the cited PDF page, or the workbook cell snippet. */
import { useEffect, useState, type CSSProperties } from 'react'
import { describeLocator, type SourceLocator } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { PdfPageCrop } from './PdfPageCrop'

export type SourceUrlResult = { url: string; kind: 'pdf' | 'xlsx' | 'link' } | { error: string }

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)' }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)', fontFamily: 'var(--font-mono)' }

export function SourceViewer({
  title, locator, loadUrl, onClose,
}: {
  title: string
  locator: SourceLocator
  loadUrl: () => Promise<SourceUrlResult>
  onClose: () => void
}) {
  const view = describeLocator(locator)
  const [res, setRes] = useState<SourceUrlResult | null>(null)
  useEffect(() => {
    let live = true
    loadUrl().then((r) => { if (live) setRes(r) }, () => { if (live) setRes({ error: 'Could not open the source document. Try again.' }) })
    return () => { live = false }
    // loadUrl is a fresh closure per render; the viewer loads once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div role="dialog" aria-label={`Source of ${title}`}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--c-panel)', borderRadius: 8, padding: 16, width: 'min(920px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>Source: {title}</strong>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
        {res === null && <p style={{ fontSize: 13 }}>Opening the source…</p>}
        {res && 'error' in res && <p role="alert" style={{ fontSize: 13, color: 'var(--c-red)' }}>{res.error}</p>}
        {res && !('error' in res) && view.kind === 'pdf_page' && res.kind === 'pdf' && (
          <PdfPageCrop url={res.url} page={view.page} highlight={view.rawText} />
        )}
        {res && !('error' in res) && view.kind === 'cell' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={TH}>Sheet</th><th style={TH}>Cell</th><th style={TH}>Label</th><th style={TH}>Value as printed</th><th style={TH}>Unit as printed</th></tr></thead>
              <tbody><tr>
                <td style={TD}>{view.sheet ?? '—'}</td><td style={TD}>{view.cell ?? '—'}</td><td style={TD}>{view.label ?? '—'}</td>
                <td style={TD}>{view.rawText ?? '—'}</td><td style={TD}>{view.rawUnit ?? 'none printed'}</td>
              </tr></tbody>
            </table>
            <a href={res.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>Download the workbook</a>
          </div>
        )}
        {res && !('error' in res) && (view.kind === 'none' || (view.kind === 'pdf_page' && res.kind !== 'pdf')) && (
          <p style={{ fontSize: 13 }}>
            No page or cell was recorded for this value.{' '}
            <a href={res.url} target="_blank" rel="noreferrer">Open the source document</a>
          </p>
        )}
      </div>
    </div>
  )
}
