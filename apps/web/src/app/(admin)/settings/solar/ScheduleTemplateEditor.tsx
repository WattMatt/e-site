'use client'
/** Org Solar schedule template (spec §14.1 "editable in org settings"). Owner/admin only — the page gates it. */
import { useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE, type ScheduleTemplateItem } from '@esite/shared'
import { removeTemplateRow, rowsToTemplate, templateToRows, type TemplateRow } from '@/lib/solar/schedule/template-editor'
import { saveOrgScheduleTemplateAction } from '@/actions/solar-schedule-template.actions'

const BLANK: TemplateRow = { name: '', category: '', zone: '', offsetDays: '0', durationDays: '5', isMilestone: false, follows: '' }
const cell = { fontSize: 12, padding: '4px 6px', width: '100%' } as const

export function ScheduleTemplateEditor({ initialItems, updatedAt, isDefault }: {
  initialItems: ScheduleTemplateItem[]; updatedAt: string | null; isDefault: boolean
}) {
  const [rows, setRows] = useState<TemplateRow[]>(() => templateToRows(initialItems))
  const [token, setToken] = useState<string | null>(updatedAt)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (i: number, patch: Partial<TemplateRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  async function save() {
    setNotice(null)
    const { items, errors: errs } = rowsToTemplate(rows)
    setErrors(errs)
    if (errs.length) return
    setBusy(true)
    const res = await saveOrgScheduleTemplateAction({ items, expectedUpdatedAt: token })
    setBusy(false)
    if ('error' in res) { setErrors([res.error]); return }
    setToken(res.updatedAt)
    setNotice('Template saved.')
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Schedule template</span></CardHeader>
      <CardBody>
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>
          <strong>{isDefault ? 'Using the standard programme' : 'Your organisation’s programme'}</strong> — “Use template” on a project’s Schedule tab inserts these,
          dated from the start you choose. Days are counted in the project’s duration mode. “Follows” uses row numbers, e.g. 1FS+2d, 3SS.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['#', 'Item', 'Category', 'Zone', 'Offset', 'Days', 'Milestone', 'Follows', ''].map((hd) => <th key={hd} style={{ textAlign: 'left', padding: 4 }}>{hd}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 4 }}>{i + 1}</td>
                  <td><input aria-label="Item name" style={cell} value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
                  <td><input aria-label="Category" style={cell} value={r.category} onChange={(e) => set(i, { category: e.target.value })} /></td>
                  <td><input aria-label="Zone" style={cell} value={r.zone} onChange={(e) => set(i, { zone: e.target.value })} /></td>
                  <td><input aria-label="Offset days" style={cell} inputMode="numeric" value={r.offsetDays} onChange={(e) => set(i, { offsetDays: e.target.value })} /></td>
                  <td><input aria-label="Duration days" style={cell} inputMode="numeric" disabled={r.isMilestone} value={r.durationDays} onChange={(e) => set(i, { durationDays: e.target.value })} /></td>
                  <td><input aria-label="Milestone" type="checkbox" checked={r.isMilestone} onChange={(e) => set(i, { isMilestone: e.target.checked })} /></td>
                  <td><input aria-label="Follows" style={cell} value={r.follows} onChange={(e) => set(i, { follows: e.target.value })} /></td>
                  <td><button type="button" aria-label="Remove item" onClick={() => setRows((rs) => removeTemplateRow(rs, i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {errors.length > 0 && <ul role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {notice && <p role="status" style={{ fontSize: 12, color: 'var(--c-green)' }}>{notice}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setRows((rs) => [...rs, { ...BLANK }])}>Add item</button>
          <button type="button" onClick={() => setRows(templateToRows(DEFAULT_SOLAR_SCHEDULE_TEMPLATE))}>Reset to the standard programme</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={save}>Save template</button>
        </div>
      </CardBody>
    </Card>
  )
}
