/**
 * Ingest ONE tariff source file into the tariffs library (D-03). Run by E-Site
 * staff on a machine with the source drive. DRY RUN BY DEFAULT: parses,
 * validates, diffs and prints the plan; writes nothing.
 *
 *   pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest.ts <file> \
 *     --parser province_xlsx|eskom_xlsm|rfd_pdf --fy 2025/26 \
 *     [--licensee "CITY POWER"] [--url <source url>] [--create-licensees] [--correct-published] [--apply] [--json]
 *
 * --correct-published: read the file again even if it was ingested, and give each
 * PUBLISHED or superseded year it covers a correction draft (00232). Nothing live
 * changes until a platform admin publishes the correction, which replaces the year.
 *
 * With NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set, a dry run
 * reads the live registry (licensee aliases, existing years, the published
 * predecessor for YoY). Without them it uses an in-memory store seeded from
 * the registry data file (--registry, default scripts/tariffs/data/licensee-registry.json).
 * Seed the registry (seed-licensee-registry.ts) BEFORE the first --apply.
 * --apply requires both variables and uploads to the private tariff-sources
 * bucket; years land in 'in_review' and are never published from here.
 * rfd_pdf needs poppler's pdftotext on PATH (brew install poppler).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DEFAULT_REGISTRY, loadRegistry, RULES_PDF } from './registry-file.ts'
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
    console.error('usage: ingest.ts <file> --parser province_xlsx|eskom_xlsm|rfd_pdf --fy 2026/27 [--licensee NAME] [--url URL] [--create-licensees] [--correct-published] [--apply] [--json]')
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

  // Owner default 9: the Eskom SSEG rule cites the stored Net-Billing Rules PDF by sha256.
  const rulesPath = arg('rules-pdf') ?? (process.env.TARIFF_SOURCE_DIR ? join(process.env.TARIFF_SOURCE_DIR, RULES_PDF) : undefined)
  const netBillingRulesSha256 = parser === 'eskom_xlsm' && rulesPath && existsSync(rulesPath)
    ? createHash('sha256').update(readFileSync(rulesPath)).digest('hex')
    : null
  if (parser === 'eskom_xlsm' && !netBillingRulesSha256) {
    if (apply) {
      console.error('--apply for eskom_xlsm needs the Net-Billing Rules PDF (owner default 9): pass --rules-pdf or set TARIFF_SOURCE_DIR')
      process.exit(2)
    }
    console.error('(no Net-Billing Rules PDF found: this dry run plans an uncited SSEG rule; --apply would refuse)')
  }

  const plan = await buildIngestPlan({
    parser, fileName: basename(file), bytes, sha256, financialYear: fy, pdfText,
    licenseeName: arg('licensee'), url: arg('url') ?? null, retrievedAt: new Date().toISOString(),
    netBillingRulesSha256,
  })
  // Without a database, dry-run against the reviewed registry data file (owner default 4) so
  // licensee resolution is exercised exactly as it will be once the registry is seeded.
  const store = url && key
    ? createSupabaseTariffStore(url, key)
    : createMemoryTariffStore({ licensees: loadRegistry(arg('registry') ?? DEFAULT_REGISTRY).map(({ name, kind, aliases }) => ({ name, kind, aliases })) })
  if (!(url && key)) console.error('(no database credentials: dry run against the registry data file, no years)')
  const report = await runIngest(plan, store, { apply, createMissingLicensees: flag('create-licensees'), correctPublished: flag('correct-published') })

  if (flag('json')) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`${report.status.toUpperCase()}  sha256 ${report.sha256}  -> tariff-sources/${report.storagePath}`)
  for (const y of report.years) {
    const yoy = y.yoy ? `  yoy +${y.yoy.added} -${y.yoy.removed} ~${y.yoy.changed} out-of-band ${y.yoy.outOfBand}` : ''
    console.log(`  ${y.action.padEnd(24)} ${y.licensee}  tariffs ${y.tariffs}  charges ${y.charges}  block ${y.blocking}  review ${y.review}  unresolved ${y.unresolved}${yoy}`)
  }
  if (report.status === 'dry_run') console.log('Nothing written. Re-run with --apply to load (years land in_review).')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
