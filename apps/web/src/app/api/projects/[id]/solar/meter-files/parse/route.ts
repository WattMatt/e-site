/**
 * POST /api/projects/[id]/solar/meter-files/parse   { fileIds: uuid[1..20], options?: { [fileId]: ParseOptions } }
 * Parses each stored raw file server-side (the browser never parses what is stored), records an
 * import report and the detected facts on the file row, and returns the review model per file
 * (one per sheet for .xlsx). Gate: Solar Edit on the project.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseMeterFile, parseMeterWorkbook, METER_PARSER_VERSION, SOURCE_UNITS, type MeterParseOutcome, type ParseOptions } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { createMeterImportRepo } from '@/lib/solar/meter-import/repo'
import { buildReviewModel, fileParsePatch, lookupIdentity, type ReviewModel } from '@/lib/solar/meter-import/review'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KNOWN_UNITS = SOURCE_UNITS.filter((u) => u !== 'unknown') as [string, ...string[]]
const Options = z.object({
  dateOrder: z.enum(['DMY', 'MDY', 'YMD']).optional(),
  tsConvention: z.enum(['begin', 'end']).optional(),
  units: z.record(z.enum(KNOWN_UNITS)).optional(),
  areaM2: z.number().positive().nullable().optional(),
}).strict()
const Body = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(20), options: z.record(Options).optional() }).strict()

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })

  const repo = createMeterImportRepo(supabase)
  const orgId = await repo.projectOrg(projectId)
  if (!orgId) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const results: Array<{ fileId: string; reviews: ReviewModel[] } | { fileId: string; error: string }> = []
  for (const fileId of parsed.data.fileIds) {
    const file = await repo.getFile(fileId)
    if (!file || file.project_id !== projectId) {
      results.push({ fileId, error: 'not_found' })
      continue
    }
    const bytes = await repo.downloadRaw(file.storage_path)
    if (!bytes) {
      results.push({ fileId, error: 'raw_file_missing' })
      continue
    }
    const options: ParseOptions = (parsed.data.options?.[fileId] ?? {}) as ParseOptions
    const outcomes: Array<{ sheetName: string | null; outcome: MeterParseOutcome }> = /\.xlsx$/i.test(file.original_name)
      ? (await parseMeterWorkbook({ bytes, fileName: file.original_name, options })).map((s) => ({ sheetName: s.sheetName, outcome: s.outcome }))
      : [{ sheetName: null, outcome: await parseMeterFile({ bytes, fileName: file.original_name, options }) }]

    const reviews: ReviewModel[] = []
    for (const { sheetName, outcome } of outcomes) {
      const identity = outcome.kind === 'series' ? await lookupIdentity(repo, orgId, outcome, file.id) : null
      const registerHints = outcome.kind === 'series' ? await repo.registerForFile(orgId, { label: outcome.filename.label, shopNo: outcome.filename.shopNo }) : []
      const reportId = await repo.insertReport({ file_id: file.id, parser_version: METER_PARSER_VERSION, options, report: { ...outcome.report, sheetName } })
      reviews.push(buildReviewModel({ fileId: file.id, fileName: file.original_name, sheetName, reportId, outcome, identity, registerHints }))
    }
    // The file row records the first sheet's facts (or the only outcome's).
    if (file.status !== 'accepted') await repo.updateFile(file.id, fileParsePatch(outcomes[0].outcome))
    results.push({ fileId, reviews })
  }
  return NextResponse.json({ results }, { status: 200 })
}
