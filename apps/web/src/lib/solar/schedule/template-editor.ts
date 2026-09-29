/**
 * Template items ⇄ editable rows. "Follows" uses the import notation by ROW
 * number (1FS+2d, 3SS), so there is one notation for people to learn. Rows get
 * keys t1…tN on the way back; validateScheduleTemplate's sentences name those
 * keys, so they are rewritten to row numbers before a person sees them.
 */
import { parsePredecessors, validateScheduleTemplate, type ScheduleTemplateItem } from '@esite/shared'

export interface TemplateRow {
  name: string
  category: string
  zone: string
  offsetDays: string
  durationDays: string
  isMilestone: boolean
  follows: string
}

const lagText = (n: number) => (n > 0 ? `+${n}d` : n < 0 ? `${n}d` : '')

export function templateToRows(items: readonly ScheduleTemplateItem[]): TemplateRow[] {
  const pos = new Map(items.map((it, i) => [it.key, i + 1]))
  return items.map((it) => ({
    name: it.name, category: it.category, zone: it.zone,
    offsetDays: String(it.offsetDays), durationDays: String(it.durationDays), isMilestone: it.isMilestone,
    follows: it.after.filter((a) => pos.has(a.key)).map((a) => `${pos.get(a.key)}${a.type}${lagText(a.lagDays)}`).join(', '),
  }))
}

/**
 * Drop row `index` (0-based). Follows cells are by row NUMBER, so every later
 * reference shifts down by one and references to the removed row go — without
 * this, removing row 3 would silently re-point "4FS" at a different item.
 * A cell that cannot be read is left as typed for the person to fix.
 */
export function removeTemplateRow(rows: readonly TemplateRow[], index: number): TemplateRow[] {
  const removed = index + 1
  return rows.filter((_, k) => k !== index).map((r) => {
    const parsed = parsePredecessors(r.follows)
    if (parsed === null) return r
    const follows = parsed
      .filter((p) => p.position !== removed)
      .map((p) => `${p.position > removed ? p.position - 1 : p.position}${p.type}${lagText(p.lagDays)}`)
      .join(', ')
    return { ...r, follows }
  })
}

const byRow =(e: string) => e.replace(/^Item "t(\d+)"/, 'Row $1').replace(/"t(\d+)"/g, 'row $1').replace(/\bt(\d+)\b/g, 'row $1')

export function rowsToTemplate(rows: readonly TemplateRow[]): { items: ScheduleTemplateItem[]; errors: string[] } {
  const errors: string[] = []
  const items: ScheduleTemplateItem[] = rows.map((r, i) => {
    if (!r.name.trim()) errors.push(`Row ${i + 1} needs a name.`)
    const parsed = parsePredecessors(r.follows)
    if (parsed === null) errors.push(`Row ${i + 1}: "${r.follows}" should look like 1FS+2d, 3SS.`)
    const after = (parsed ?? []).flatMap((p) => {
      if (p.position < 1 || p.position > rows.length) { errors.push(`Row ${i + 1}: row ${p.position} does not exist.`); return [] }
      return [{ key: `t${p.position}`, type: p.type, lagDays: p.lagDays }]
    })
    const offset = Number(r.offsetDays.trim() || '0')
    const duration = r.isMilestone ? 0 : Number(r.durationDays.trim())
    return {
      key: `t${i + 1}`, name: r.name.trim(), category: r.category.trim(), zone: r.zone.trim(),
      offsetDays: Number.isFinite(offset) ? offset : -1, durationDays: Number.isFinite(duration) ? duration : 0,
      isMilestone: r.isMilestone, after,
    }
  })
  if (errors.length) return { items, errors }
  return { items, errors: validateScheduleTemplate(items).map(byRow) }
}
