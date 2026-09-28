import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { readXlsxTable } from '@/lib/solar/schedule/read-xlsx'
import {
  guessImportMapping, isMsProjectXml, parseCsvText, parseMsProjectXml, solarLevelAllows, validateImportPlan,
} from '@esite/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 5 * 1024 * 1024
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * POST /api/projects/[id]/solar/schedule/import/parse — reads an uploaded
 * programme and returns it for the Import dialog's mapping and preview.
 * Writes nothing. Outside (admin)/layout.tsx, so it gates itself: Edit level.
 *
 * 200 { kind: 'table', rows, mapping, unrecognisedColumns }  (CSV / XLSX)
 * 200 { kind: 'plan', plan, issues }                          (MS Project XML)
 * 4xx { error }  — always a sentence.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return bad('That project could not be found.')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('You are not signed in.', 401)
  const level = await getSolarAccessLevel(id, supabase as never)
  if (!solarLevelAllows(level, 'edit')) return bad('You need Edit access to Solar on this project to import a programme.', 403)

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return bad('Choose a file to import.')
  if (file.size > MAX_BYTES) return bad('That file is larger than 5 MB.', 413)
  const name = file.name.toLowerCase()
  try {
    if (name.endsWith('.xml')) {
      const text = await file.text()
      if (!isMsProjectXml(text)) return bad('That XML file is not a Microsoft Project file. In Project, use Save As → XML.')
      const { plan, issues } = parseMsProjectXml(text)
      return NextResponse.json({ kind: 'plan', plan, issues: [...issues, ...validateImportPlan(plan)] })
    }
    let rows: string[][]
    if (name.endsWith('.csv')) rows = parseCsvText(await file.text())
    else if (name.endsWith('.xlsx')) rows = await readXlsxTable(Buffer.from(await file.arrayBuffer()), 10_000)
    else return bad('Use a .csv, .xlsx or Microsoft Project .xml file. Save older .xls files as .xlsx first.')
    // Blank rows stay in the table so "Row N" in the preview matches the file; they are not tasks.
    const taskRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== '')).length
    if (taskRows === 0) return bad('The file has no tasks under its header row.')
    if (taskRows > 2000) return bad('At most 2,000 tasks can be imported at once.')
    const mapping = guessImportMapping(rows[0])
    const used = new Set(Object.values(mapping).filter((v): v is number => v !== null))
    const unrecognisedColumns = rows[0].map((h, i) => (used.has(i) ? '' : h.trim())).filter(Boolean)
    return NextResponse.json({ kind: 'table', rows, mapping, unrecognisedColumns })
  } catch (err) {
    console.error('[solar-schedule-import] parse failed', { project: id, err: String(err) })
    return bad('That file could not be read. Check it opens in Excel and try again.')
  }
}
