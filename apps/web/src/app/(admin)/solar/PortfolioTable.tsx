'use client'
/**
 * Portfolio table + filters + KPIs (spec §15). Every cell is a React text node (the reference tool
 * built map popups from injected HTML — stored XSS); no dangerouslySetInnerHTML anywhere here.
 */
import { useState } from 'react'
import Link from 'next/link'
import { kwp, zar } from '@esite/shared/solar-reports'
import { filterPortfolio, portfolioFilterOptions, portfolioKpis, STAGE_LABELS, type PortfolioRow } from '@/lib/solar/portfolio-model'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

export function PortfolioTable({ rows, isAdmin }: { rows: PortfolioRow[]; isAdmin: boolean }) {
  const [f, setF] = useState({ stage: '', province: '', licensee: '' })
  const shown = filterPortfolio(rows, f)
  const k = portfolioKpis(shown)
  const opts = portfolioFilterOptions(rows)
  if (rows.length === 0) return <p style={{ fontSize: 13 }}>No Solar projects you can see yet — open a project’s Solar tab to start a study.</p>
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">Portfolio</span></CardHeader>
        <CardBody>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            <span>{`Projects: ${k.projects}`}</span>
            <span>{`kWp designed: ${kwp(k.kwpDesigned)}`}</span>
            <span>{`kWp proposed: ${kwp(k.kwpProposed)}`}</span>
            <span>{`kWp accepted: ${kwp(k.kwpAccepted)}`}</span>
            {k.year1SavingZar !== null && <span>{`Year-1 saving (${k.savingRows} project${k.savingRows === 1 ? '' : 's'} you may see): ${zar(k.year1SavingZar)}`}</span>}
            <span>kWp operating: available with Operations (Phase 7)</span>
            <span>Generation YTD vs guarantee: available with Operations (Phase 7)</span>
          </div>
        </CardBody>
      </Card>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <label>Status{' '}
          <select aria-label="Status" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
            <option value="">All</option>
            {Object.entries(STAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Province{' '}
          <select aria-label="Province" value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}>
            <option value="">All</option>
            {opts.provinces.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>Supply authority{' '}
          <select aria-label="Supply authority" value={f.licensee} onChange={(e) => setF({ ...f, licensee: e.target.value })}>
            <option value="">All</option>
            {opts.licensees.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>{['Project', 'Location', 'Supply authority', 'Status', 'Selected case', 'kWp', 'Year-1 saving', 'Last activity', ''].map((h) => <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid var(--c-border)', padding: 6 }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.projectId}>
                <td style={{ padding: 6 }}>{r.projectName}</td>
                <td style={{ padding: 6 }}>{[r.city, r.province].filter(Boolean).join(', ')}</td>
                <td style={{ padding: 6 }}>{r.licenseeName ?? ''}</td>
                <td style={{ padding: 6 }}>{STAGE_LABELS[r.stage]}</td>
                <td style={{ padding: 6 }}>{r.selectedCaseName ?? 'None selected'}</td>
                <td style={{ padding: 6 }}>{r.selectedKwp === null ? '' : kwp(r.selectedKwp)}</td>
                <td style={{ padding: 6 }}>{r.canSeeMoney && r.year1SavingZar !== null ? zar(r.year1SavingZar) : ''}</td>
                <td style={{ padding: 6 }}>{r.lastActivity ? r.lastActivity.slice(0, 10) : ''}</td>
                <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                  <Link href={`/projects/${r.projectId}/solar/overview`} aria-label={`Open ${r.projectName}`}>Open</Link>
                  {isAdmin && <>{' · '}<Link href={`/projects/${r.projectId}/solar/access`} aria-label={`Manage access for ${r.projectName}`}>Manage access</Link></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
