'use client'
/**
 * Charges table (spec §5): every stored charge, nothing hidden; View source
 * per row. The source viewer's loadUrl closure is built HERE over the server
 * action (the page hands this component JSON only).
 */
import { useState, type CSSProperties } from 'react'
import { COMPONENT_LABELS, SEASON_LABELS, TOU_LABELS, formatChargeAmount, type TariffSeason, type TouOrAll } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { SourceViewer } from '@/components/tariffs/SourceViewer'
import { getSolarTariffSourceUrlAction } from '@/actions/solar-tariff.actions'
import type { PinnedCharge } from '@/lib/solar/tariff/rows'

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)' }

function cite(c: PinnedCharge): string {
  if (!c.sourceTitle) return '—'
  const l = c.locator
  if (typeof l.page === 'number') return `${c.sourceTitle}, page ${l.page}`
  if (l.sheet || l.cell) return `${c.sourceTitle}, ${[l.sheet, l.cell].filter(Boolean).join(' ')}`
  return c.sourceTitle
}

export function ChargesTable({ projectId, charges }: { projectId: string; charges: PinnedCharge[] }) {
  const [viewing, setViewing] = useState<PinnedCharge | null>(null)
  if (charges.length === 0) return <p style={{ fontSize: 13 }}>This tariff has no charges in the library. Report it as a tariff error.</p>
  const title = (c: PinnedCharge) => `${COMPONENT_LABELS[c.component]} (${SEASON_LABELS[c.season as TariffSeason] ?? c.season}, ${TOU_LABELS[c.tou as TouOrAll] ?? c.tou})`
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={TH}>Component</th><th style={TH}>Season</th><th style={TH}>TOU period</th><th style={TH}>Block (kWh)</th><th style={TH}>Amount (excl. VAT)</th><th style={TH}>Source</th><th style={TH} /></tr></thead>
        <tbody>{charges.map((c) => (
          <tr key={c.id}>
            <td style={TD}>{COMPONENT_LABELS[c.component]}</td>
            <td style={TD}>{SEASON_LABELS[c.season as TariffSeason] ?? c.season}</td>
            <td style={TD}>{TOU_LABELS[c.tou as TouOrAll] ?? c.tou}{c.dayType !== 'all' ? ` (${c.dayType})` : ''}</td>
            <td style={TD}>{c.blockMin === null ? '—' : `${c.blockMin}–${c.blockMax ?? '∞'} kWh`}</td>
            <td style={TD}>{formatChargeAmount(c.amount, c.unit)}</td>
            <td style={TD}>{cite(c)}</td>
            <td style={TD}><Button variant="ghost" size="sm" disabled={!c.sourceDocumentId} onClick={() => setViewing(c)}>View source</Button></td>
          </tr>
        ))}</tbody>
      </table>
      {viewing && viewing.sourceDocumentId && (
        <SourceViewer title={title(viewing)} locator={viewing.locator}
          loadUrl={() => getSolarTariffSourceUrlAction({ projectId, sourceDocumentId: viewing.sourceDocumentId as string })}
          onClose={() => setViewing(null)} />
      )}
    </div>
  )
}
