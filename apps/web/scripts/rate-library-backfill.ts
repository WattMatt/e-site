/**
 * Rate library backfill (E6): load historical priced BOQs into the library.
 * ========================================================================
 * READ-ONLY on every source. Writes only the rate_* tables (00225). Re-running
 * is safe: a source already in the library is reported and skipped.
 *
 * Sources come from a MANIFEST kept outside the repo, because which
 * contractor priced which project is commercially confidential:
 *
 *   {
 *     "organisationId": "<uuid>",
 *     "sources": [
 *       { "type": "project_boq", "projectId": "<uuid>", "contractorName": "…" },
 *       { "type": "sheet_text", "file": "/abs/path.txt", "contractorName": "…",
 *         "province": "Gauteng", "pricedOn": "2026-06-25", "pricedOnBasis": "document_date",
 *         "projectLabel": "…", "sourceRef": "…", "sourceFile": "original.xlsx" }
 *     ]
 *   }
 *
 * project_boq   the project's CURRENT import in projects.boq_*. Base date =
 *               the import date (pricedOnBasis "import_date") unless the
 *               manifest states one. Province = the project's province.
 * sheet_text    "--- sheet: X ---" text extracted from a priced workbook,
 *               parsed by parsePricedSheets; each bill must reconcile to its
 *               stated total or the source is refused.
 *
 * Usage (from repo root):
 *   node --conditions=react-server --import tsx apps/web/scripts/rate-library-backfill.ts --manifest <file> [--apply]
 * Without --apply it is a dry run: it parses, matches and prints the
 * reconciliation report, and writes nothing.
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { parsePricedSheets, planIngest, splitExtractedSheetText, type IngestLine } from '@esite/shared'
import { ingestSource, loadKnownItems, type SourceMeta } from '../src/lib/rate-library/data'
import { loadProjectBoq } from '../src/lib/rate-library/project-boq'
import { SA_PROVINCES } from '../src/lib/rate-library/format'

interface ProjectBoqSource { type: 'project_boq'; projectId: string; contractorName: string; pricedOn?: string; pricedOnBasis?: SourceMeta['pricedOnBasis'] }
interface SheetTextSource {
  type: 'sheet_text'; file: string; contractorName: string; province: string | null; pricedOn: string
  pricedOnBasis: SourceMeta['pricedOnBasis']; projectLabel: string | null; sourceRef: string; sourceFile: string | null
}
interface Manifest { organisationId: string; sources: (ProjectBoqSource | SheetTextSource)[] }

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const manifestPath = args[args.indexOf('--manifest') + 1]
if (!manifestPath || args.indexOf('--manifest') < 0) { console.error('usage: --manifest <file> [--apply]'); process.exit(2) }
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(2) }

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
const db = createClient(url, key, { auth: { persistSession: false } })
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const round2 = (n: number) => Math.round(n * 100) / 100

async function prepare(s: ProjectBoqSource | SheetTextSource): Promise<{ meta: SourceMeta; lines: IngestLine[]; report: string[]; ok: boolean }> {
  if (s.type === 'project_boq') {
    const { data: p, error } = await db.schema('projects').from('projects').select('id, name, province, organisation_id').eq('id', s.projectId).single()
    if (error || !p) throw new Error(`project ${s.projectId}: ${error?.message ?? 'not found'}`)
    if (p.organisation_id !== manifest.organisationId) throw new Error(`project ${p.name} is not in organisation ${manifest.organisationId}`)
    const boq = await loadProjectBoq(db, s.projectId)
    if (!boq) throw new Error(`project ${p.name} has no current BOQ import`)
    if (boq.libraryPricedAt) throw new Error(`project ${p.name}: library rates were applied to this import on ${boq.libraryPricedAt}; it is not a contractor's prices`)
    // Variation items carry an approved value change, not a unit rate.
    boq.lines = boq.lines.filter(l => l.origin !== 'variation')
    const sumLines = round2(boq.lines.reduce((a, l) => a + (l.amount ?? 0), 0))
    const report = [
      `  lines in current import: ${boq.lines.length}`,
      `  import total ex VAT:     ${money(boq.totalExVat)}`,
      `  sum of line amounts:     ${money(sumLines)}`,
      `  difference:              ${boq.totalExVat === null ? '—' : money(round2(boq.totalExVat - sumLines))} (bill-level additions such as P&G or contingency are not lines)`,
    ]
    return {
      ok: true, report, lines: boq.lines,
      meta: {
        kind: 'boq_import', sourceRef: boq.importId, contractorName: s.contractorName, projectId: p.id, projectLabel: p.name,
        province: SA_PROVINCES.includes((p.province ?? '').trim() as (typeof SA_PROVINCES)[number]) ? p.province!.trim() : null, pricedOn: s.pricedOn ?? boq.importedAt.slice(0, 10), pricedOnBasis: s.pricedOnBasis ?? 'import_date',
        sourceFile: boq.sourceFilename, totalExVat: boq.totalExVat,
        reconciliation: { lines: boq.lines.length, sumOfLineAmounts: sumLines, importTotalExVat: boq.totalExVat },
      },
    }
  }
  const parsed = parsePricedSheets(splitExtractedSheetText(readFileSync(s.file, 'utf8')))
  const bad = parsed.reconciliation.filter(r => r.difference === null || Math.abs(r.difference) > 0.01)
  const report = parsed.reconciliation.map(r => `  ${r.sheet.padEnd(14)} stated ${money(r.statedTotal).padStart(16)}  lines ${money(r.sumOfLines).padStart(16)}  diff ${money(r.difference)}`)
  const lines: IngestLine[] = parsed.lines.map(l => ({
    sheet: l.sheet, rowRef: `${l.sheet}!R${l.row}${l.mergedCodes.length > 1 ? `+${l.mergedCodes.slice(1).join('+')}` : ''}`, code: l.code,
    sectionPath: l.sectionPath, description: l.description, unit: l.unit, quantity: l.quantity,
    supplyRate: l.supplyRate, installRate: l.installRate, rate: l.rate, amount: l.amount, quantityMode: null,
  }))
  const total = round2(parsed.reconciliation.reduce((a, r) => a + (r.statedTotal ?? 0), 0))
  return {
    ok: bad.length === 0, report, lines,
    meta: {
      kind: 'historical_file', sourceRef: s.sourceRef, contractorName: s.contractorName, projectId: null, projectLabel: s.projectLabel,
      province: s.province, pricedOn: s.pricedOn, pricedOnBasis: s.pricedOnBasis, sourceFile: s.sourceFile, totalExVat: total,
      reconciliation: { bills: parsed.reconciliation, reconciled: bad.length === 0 },
    },
  }
}

async function main() {
  console.log(`Rate library backfill — ${apply ? 'APPLY' : 'DRY RUN (nothing written)'} — ${manifest.sources.length} source(s)\n`)
  let failed = 0
  for (const s of manifest.sources) {
    const label = s.type === 'project_boq' ? `project ${s.projectId}` : s.sourceRef
    console.log(`■ ${label} — ${s.contractorName}`)
    try {
      const { meta, lines, report, ok } = await prepare(s)
      report.forEach(r => console.log(r))
      if (!ok) { console.log('  ✗ does not reconcile to the cent — refused'); failed++; continue }
      let known: Awaited<ReturnType<typeof loadKnownItems>> = []
      try { known = await loadKnownItems(db, manifest.organisationId) } catch (e) {
        if (apply) throw e
        console.log(`  (catalogue not readable — ${e instanceof Error ? e.message : e}; planning against an empty catalogue)`)
      }
      const plan = planIngest(lines, known)
      const c = (st: string) => plan.lines.filter(l => l.status === st).length
      const reasons: Record<string, number> = {}
      plan.lines.filter(l => l.exclusionReason).forEach(l => { reasons[l.exclusionReason!] = (reasons[l.exclusionReason!] ?? 0) + 1 })
      console.log(`  matched: ${c('auto_confirmed')} auto · ${c('suggested')} suggested · ${c('unmatched')} unmatched (queued) · ${c('excluded')} excluded ${JSON.stringify(reasons)}`)
      console.log(`  → ${plan.newItems.length} new catalogue item(s), ${plan.observations.length} observation(s) after collapsing repeats`)
      if (apply) {
        const res = await ingestSource(db, manifest.organisationId, meta, lines)
        console.log(res.alreadyImported ? '  = already in the library, skipped' : `  ✓ written: source ${res.sourceId} ${JSON.stringify(res.counts)}`)
      }
    } catch (e) {
      failed++
      console.log(`  ✗ ${e instanceof Error ? e.message : String(e)}`)
    }
    console.log('')
  }
  process.exit(failed ? 1 : 0)
}

main()
