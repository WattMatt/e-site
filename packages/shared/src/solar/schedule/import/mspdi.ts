/**
 * Microsoft Project XML (MSPDI) → ImportPlan. Summary tasks are not imported;
 * their names become the category (outline level 1) and zone (level 2) of the
 * tasks beneath them. Dates are the first 10 characters of <Start>/<Finish>
 * (a local date-time in the file) — no time-zone conversion. Link <Type>:
 * 0 FF, 1 FS, 2 SF, 3 SS. <LinkLag> is in tenths of a minute: 4800 per
 * 8-hour working day, 14400 per elapsed day (LagFormat 8/elapsed forms).
 */
import { isCalendarDate } from '../dates'
import type { LinkType } from '../graph'
import type { ImportIssue, ImportPlan, PlannedLink, PlannedTask } from './plan'

const TYPE: Record<string, LinkType> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' }
const ELAPSED_FORMATS = new Set(['4', '6', '8', '10', '12', '20', '36', '38', '40', '42', '44'])

export function isMsProjectXml(text: string): boolean {
  return /<Project[^>]*xmlns="http:\/\/schemas\.microsoft\.com\/project"/.test(text)
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)
  return m ? decodeXml(m[1].trim()) : null
}

export function parseMsProjectXml(xml: string): { plan: ImportPlan; issues: ImportIssue[] } {
  const issues: ImportIssue[] = []
  const tasks: PlannedTask[] = []
  const summaries = new Set<string>()
  const outline: string[] = []
  const rawLinks: Array<{ toUid: string; toName: string; fromUid: string; type: LinkType; lagDays: number }> = []
  for (const m of xml.matchAll(/<Task>([\s\S]*?)<\/Task>/g)) {
    const b = m[1]
    const uid = tag(b, 'UID') ?? ''
    const name = tag(b, 'Name') ?? ''
    const level = Number(tag(b, 'OutlineLevel') ?? '1')
    if (uid === '0' || tag(b, 'IsNull') === '1') continue
    if (tag(b, 'Summary') === '1') {
      summaries.add(uid)
      outline[level] = name
      outline.length = level + 1
      continue
    }
    if (!name) continue
    const start = (tag(b, 'Start') ?? '').slice(0, 10)
    const finish = (tag(b, 'Finish') ?? '').slice(0, 10)
    if (!isCalendarDate(start) || !isCalendarDate(finish)) {
      issues.push({ row: null, message: `"${name}" has no usable start or finish date in the Project file.` })
      continue
    }
    const isMilestone = tag(b, 'Milestone') === '1'
    const progress = Math.min(100, Math.max(0, Math.round(Number(tag(b, 'PercentComplete') ?? '0') || 0)))
    tasks.push({
      key: `uid:${uid}`, sourceRow: null, name,
      category: level >= 2 ? outline[1] ?? '' : '', zone: level >= 3 ? outline[2] ?? '' : '',
      start, end: isMilestone ? start : finish, isMilestone, progress,
      status: progress >= 100 ? 'done' : progress > 0 ? 'in_progress' : 'not_started',
      colour: null, ownerHint: null, description: tag(b, 'Notes') ?? '', segments: [],
    })
    for (const l of b.matchAll(/<PredecessorLink>([\s\S]*?)<\/PredecessorLink>/g)) {
      const fromUid = tag(l[1], 'PredecessorUID') ?? ''
      const lag = Number(tag(l[1], 'LinkLag') ?? '0') || 0
      const per = ELAPSED_FORMATS.has(tag(l[1], 'LagFormat') ?? '') ? 14400 : 4800
      rawLinks.push({ toUid: uid, toName: name, fromUid, type: TYPE[tag(l[1], 'Type') ?? '1'] ?? 'FS', lagDays: Math.round(lag / per) })
    }
  }
  const known = new Set(tasks.map((t) => t.key))
  const links: PlannedLink[] = []
  for (const r of rawLinks) {
    if (summaries.has(r.fromUid)) {
      issues.push({ row: null, message: `"${r.toName}" depends on a summary task in Project; that link was left out.` })
      continue
    }
    if (!known.has(`uid:${r.fromUid}`)) continue
    links.push({ fromKey: `uid:${r.fromUid}`, toKey: `uid:${r.toUid}`, type: r.type, lagDays: r.lagDays })
  }
  return { plan: { tasks, links }, issues }
}
