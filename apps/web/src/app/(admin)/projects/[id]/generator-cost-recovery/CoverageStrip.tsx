'use client'

import type { ZoneCoverage } from './tenant-display'

interface Props {
  perZone: ZoneCoverage[]
  configured: number
  total: number
}

export function CoverageStrip({ perZone, configured, total }: Props) {
  return (
    <div role="group" aria-label="Coverage" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <div style={cardStyle}>
        <div style={labelStyle}>Configured</div>
        <div style={valueStyle}>{configured} of {total} configured</div>
      </div>
      {perZone.map((z) => (
        <div key={z.zoneId} style={cardStyle}>
          <div style={labelStyle}>{z.zoneName}</div>
          <div style={valueStyle}>
            {z.shopCount} shop{z.shopCount === 1 ? '' : 's'} · {z.totalKw.toFixed(1)} kW
          </div>
          {z.installedKva !== null && (
            <div style={subStyle}>
              {z.installedKva} kVA installed · {((z.totalKw / z.installedKva) * 100).toFixed(0)}% utilised
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Style constants ──────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'var(--c-panel)',
  minWidth: 140,
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--c-text-dim)',
  fontWeight: 600,
}

const valueStyle: React.CSSProperties = { fontSize: 13, color: 'var(--c-text)', marginTop: 2 }

const subStyle: React.CSSProperties = { fontSize: 11, color: 'var(--c-text-dim)', marginTop: 2 }
