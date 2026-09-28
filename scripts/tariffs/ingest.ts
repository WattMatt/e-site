/**
 * Ingest ONE tariff source file into the tariffs library (D-03). Run by E-Site
 * staff on a machine with the source drive. DRY RUN BY DEFAULT: parses,
 * validates, diffs and prints the plan; writes nothing.
 *
 *   pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest.ts <file> \
 *     --parser province_xlsx|eskom_xlsm|rfd_pdf --fy 2025/26 \
 *     [--licensee "CITY POWER"] [--url <source url>] [--create-licensees] [--apply] [--json]
 *
 * With NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set, a dry run
 * reads the live registry (licensee aliases, existing years, the published
 * predecessor for YoY). Without them it uses an empty in-memory store.
 * --apply requires both variables and uploads to the private tariff-sources
 * bucket; years land in 'in_review' and are never published from here.
 * rfd_pdf needs poppler's pdftotext on PATH (brew install poppler).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { buildIngestPlan } from '../../packages/shared/src/tariffs/ingest/build-plan.ts'
import { runIngest, type ParserName } from '../../packages/shared/src/tariffs/ingest/ingest-core.ts'
import { createMemoryTariffStore } from '../../packages/shared/src/tariffs/ingest/memory-store.ts'
import { createSupabaseTariffStore } from '../../packages/shared/src/tariffs/ingest/supabase-store.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

async function main(): Promise<void> {
  const file = process.argv[2]
  const parser = arg('parser') as ParserName | undefined
  const fy = arg('fy')
  if (!file || file.startsWith('--') || !parser || !fy || !['province_xlsx', 'eskom_xlsm', 'rfd_pdf'].includes(parser)) {
    console.error('usage: ingest.ts <file> --parser province_xlsx|eskom_xlsm|rfd_pdf --fy 2026/27 [--licensee NAME] [--url URL] [--create-licensees] [--apply] [--json]')
    process.exit(2)
  }
  const apply = flag('apply')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (apply && (!url || !key)) {
    console.error('--apply needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }

  const bytes = new Uint8Array(readFileSync(file))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  let pdfText: string | undefined
  if (parser === 'rfd_pdf') {
    try {
      pdfText = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    } catch {
      console.error('pdftotext failed or is missing: brew install poppler')
      process.exit(1)
    }
  }

  const plan = await buildIngestPlan({
    parser, fileName: basename(file), bytes, sha256, financialYear: fy, pdfText,
    licenseeName: arg('licensee'), url: arg('url') ?? null, retrievedAt: new Date().toISOString(),
  })
  const store = url && key ? createSupabaseTariffStore(url, key) : createMemoryTariffStore()
  if (!(url && key)) console.error('(no database credentials: dry run against an empty registry)')
  const report = await runIngest(plan, store, { apply, createMissingLicensees: flag('create-licensees') })

  if (flag('json')) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`${report.status.toUpperCase()}  sha256 ${report.sha256}  -> tariff-sources/${report.storagePath}`)
  for (const y of report.years) {
    const yoy = y.yoy ? `  yoy +${y.yoy.added} -${y.yoy.removed} ~${y.yoy.changed} out-of-band ${y.yoy.outOfBand}` : ''
    console.log(`  ${y.action.padEnd(22)} ${y.licensee}  tariffs ${y.tariffs}  charges ${y.charges}  block ${y.blocking}  review ${y.review}  unresolved ${y.unresolved}${yoy}`)
  }
  if (report.status === 'dry_run') console.log('Nothing written. Re-run with --apply to load (years land in_review).')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
