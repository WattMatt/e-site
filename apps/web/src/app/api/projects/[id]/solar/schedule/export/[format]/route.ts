import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { loadScheduleData } from '@/lib/solar/schedule/loader'
import { ScheduleLoadError } from '@/lib/solar/schedule/load-error'
import { scheduleCalendar } from '@/lib/solar/schedule/work-calendar'
import { exportScheduleXlsx } from '@/lib/solar/schedule/export-xlsx'
import { renderSchedulePdf } from '@/lib/solar/schedule/render-schedule-pdf'
import { buildScheduleIcs, sastToday, solarLevelAllows } from '@esite/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Formats the server produces. PNG is exported in the browser; there is no Word export (owner decision Q7). */
const TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ics: 'text/calendar; charset=utf-8',
  pdf: 'application/pdf',
} as const
type ExportFormat = keyof typeof TYPES
const isFormat = (f: string): f is ExportFormat => Object.prototype.hasOwnProperty.call(TYPES, f)

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'solar'

/**
 * GET /api/projects/[id]/solar/schedule/export/[format] — xlsx | ics | pdf.
 * View level (spec §14.1 "Export — tech-read"). Outside (admin)/layout.tsx, so
 * it gates itself; reads through the caller's session (RLS decides the rows).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; format: string }> }) {
  const { id, format } = await params
  if (!isFormat(format)) return NextResponse.json({ error: 'That export format is not available.' }, { status: 404 })
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'That project could not be found.' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You are not signed in.' }, { status: 401 })
  const level = await getSolarAccessLevel(id, supabase as never)
  if (!level || !solarLevelAllows(level, 'view')) return NextResponse.json({ error: 'You do not have access to this schedule.' }, { status: 403 })

  let body: Uint8Array | string
  let name: string
  try {
    const today = sastToday()
    const data = await loadScheduleData(id, supabase as never, level, today)
    name = data.projectName
    const cal = scheduleCalendar(data.settings.durationMode, data.tasks.flatMap((t) => [t.start, t.end]), today)
    if (format === 'xlsx') body = new Uint8Array(await exportScheduleXlsx(data, cal))
    else if (format === 'pdf') body = new Uint8Array(await renderSchedulePdf(data, cal, today))
    else body = buildScheduleIcs({
      calendarName: data.projectName, now: new Date(),
      tasks: data.tasks.map((t) => ({ id: t.id, ref: t.ref, name: t.name, start: t.start, end: t.end, isMilestone: t.isMilestone, description: t.description, status: t.status, ownerName: t.ownerName })),
    })
  } catch (err) {
    if (err instanceof ScheduleLoadError) {
      console.error('[solar-schedule-export] load failed', { project: id, format, source: err.source, detail: err.detail })
      return NextResponse.json({ error: 'The schedule could not be loaded, so nothing was exported. Try again.' }, { status: 500 })
    }
    console.error('[solar-schedule-export] render failed', { project: id, format, err: String(err) })
    return NextResponse.json({ error: 'The export could not be produced. Try again.' }, { status: 500 })
  }
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': TYPES[format],
      'Content-Disposition': `attachment; filename="${slug(name)}-programme.${format}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
