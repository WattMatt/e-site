'use client'
import type { DrawingOption } from '@/lib/solar/schematics/view-types'

/** Choose a project drawing AND a page (all pages are available — WM offered page 1 only). */
export function DrawingPagePicker({ drawings, floorPlanId, page, onChange }: {
  drawings: DrawingOption[]; floorPlanId: string; page: string; onChange: (v: { floorPlanId: string; page: string }) => void
}) {
  if (drawings.length === 0) return <p style={{ fontSize: 13 }}>This project has no drawings yet — upload the single-line diagram on the Floor Plans page (Dropbox sync keeps it current).</p>
  const pdf = drawings.find((d) => d.id === floorPlanId)?.isPdf ?? false
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', fontSize: 13 }}>
      <label>Drawing<br />
        <select aria-label="Drawing" value={floorPlanId} onChange={(e) => onChange({ floorPlanId: e.target.value, page: '1' })}>
          <option value="">Choose…</option>
          {drawings.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <label>Page<br />
        <input aria-label="Page" inputMode="numeric" value={pdf ? page : '1'} disabled={!pdf} onChange={(e) => onChange({ floorPlanId, page: e.target.value })} style={{ width: 60 }} />
      </label>
      {pdf && <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>The editor shows the page count when the sheet opens.</span>}
    </div>
  )
}
