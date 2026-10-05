/**
 * Meter archive → Solar org meter library (owner decision 2026-10-05: all 42 sites, verified only).
 * ================================================================================================
 * Reads every site folder of `006. METER CSV` (READ-ONLY), plans each CSV with lib/solar/meter-archive/plan
 * (verified = sound format, unique data, and for PnP power files a serial the downloader log places at
 * THIS site), and writes a manifest. Nothing is written to the database without --apply.
 *
 * Usage — run from apps/web (tsx resolves the `@/` path alias from the tsconfig of the working directory).
 * `server-only` is not installed in apps/web (Next aliases it), so point NODE_PATH at pnpm's copy; the
 * react-server condition then resolves it to its empty build:
 *   NODE_PATH=../../node_modules/.pnpm/server-only@0.0.1/node_modules \
 *   node --max-old-space-size=6144 --conditions=react-server --import tsx scripts/solar-meter-archive.ts --root "<006. METER CSV>" --out <dir>
 *   … --apply --org <uuid> --user <uuid> [--site "KURUMAN MALL"] [--max-disk-pct 75]
 *   … --retire-projects --org <uuid> --out <dir> [--apply]   (00237 applied first: moves the first load's
 *       per-site planning projects' files into the org archive and deletes those projects)
 *
 * --apply: for each `load` decision upload the raw file to solar-meter-raw at <org>/archive/<sha256>.csv,
 * register the meter_files row with NO project (00237; the sites are not projects), and commit it through commitMeterFile (the Solar import pipeline, unchanged: server
 * re-parse, identity checks, readings read-back). Re-running is safe: an imported file is skipped.
 *
 * Env for --apply: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMeterFile, splitLines, splitRow, type MeterParseOutcome } from '@esite/shared/meter-data'
import { archiveSiteKey, planArchive, serialKey, summarise, type ArchiveDecision, type ArchiveFile } from '../src/lib/solar/meter-archive/plan'

const NOT_SITES = new Set(['001. COMPLETED SITES', '002. OVERALL SITE LAYOUTES', 'PNP-2026-09'])
const argv = process.argv.slice(2)
const arg = (f: string) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1] }
const root = arg('--root')
const out = arg('--out') ?? '.'
const only = arg('--site')
if (!root && !argv.includes('--retire-projects')) { console.error('--root <006. METER CSV folder> is required'); process.exit(2) }

function csvFiles(dir: string): string[] {
  const outFiles: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) outFiles.push(...csvFiles(p))
    else if (/\.(csv|txt)$/i.test(e) && st.size > 0) outFiles.push(p)
  }
  return outFiles
}

async function main() {
  if (argv.includes('--retire-projects')) {
    const { retireArchiveProjects } = await import('../src/lib/solar/meter-archive/apply')
    const org = arg('--org')
    if (!org) { console.error('--retire-projects needs --org <uuid>'); process.exit(2) }
    mkdirSync(out, { recursive: true })
    await retireArchiveProjects({ org, out, apply: argv.includes('--apply') })
    return
  }
  // ALWAYS plan over every site: the cross-site duplicate check and the downloader log (kept only in two
  // folders) need all of them. --site narrows what is APPLIED, never what is planned.
  const sites = readdirSync(root!).filter((d) => statSync(join(root!, d)).isDirectory() && !NOT_SITES.has(d)).sort()
  if (only && !sites.includes(only)) { console.error(`no site folder named "${only}"`); process.exit(2) }
  const files: Array<ArchiveFile & { path: string }> = []
  const serialSite = new Map<string, string>()
  const serialName = new Map<string, string>()
  for (const site of sites) {
    for (const path of csvFiles(join(root!, site))) {
      const fileName = path.split('/').pop() as string
      const parsed: MeterParseOutcome = await parseMeterFile({ bytes: new Uint8Array(readFileSync(path)), fileName })
      // Keep the metadata only: 2,000 files of readings do not fit in memory, and --apply re-parses each file.
      const outcome: MeterParseOutcome = parsed.kind === 'series' ? { ...parsed, channels: parsed.channels.map((c) => ({ ...c, readings: [] })) } : parsed
      if (outcome.kind === 'register' && outcome.format === 'E') {
        for (const r of outcome.rows) if (r.serial && r.mallName) serialSite.set(serialKey(r.serial), archiveSiteKey(r.mallName))
        // The register keeps only the first name segment; the label needs the whole name ("E0385 ; Solar 1 ; …").
        for (const line of splitLines(readFileSync(path, 'utf8')).slice(1)) {
          const [serial, name] = splitRow(line, ',')
          if (serial && name) serialName.set(serialKey(serial), name.trim())
        }
      }
      files.push({ site, fileName, outcome, path })
    }
  }
  const decisions = planArchive(files, serialSite, serialName)
  const summary = summarise(decisions)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'meter-archive-plan.json'), JSON.stringify({ sites, serialsInLog: serialSite.size, summary, decisions: decisions.map(strip) }, null, 1))
  writeFileSync(join(out, 'meter-archive-plan.csv'), toCsv(decisions))
  console.log(JSON.stringify({ sites: sites.length, serialsInLog: serialSite.size, ...summary, bySite: undefined }, null, 1))
  console.log('site\tload\tskip\treadings')
  for (const [s, v] of Object.entries(summary.bySite)) console.log(`${s}\t${v.load}\t${v.skip}\t${v.readings}`)
  if (argv.includes('--apply')) {
    const { applyArchive } = await import('../src/lib/solar/meter-archive/apply')
    await applyArchive({
      decisions: only ? decisions.filter((d) => d.site === only) : decisions, files, org: arg('--org'), user: arg('--user'), out,
      maxDiskPct: Number(arg('--max-disk-pct') ?? 75), diskUsedPct,
    })
  }
}

const strip = (d: ArchiveDecision) => d

/** Filesystem use of the project's database disk (Management API; token from SUPABASE_ACCESS_TOKEN or the keychain). */
async function diskUsedPct(): Promise<number | null> {
  try {
    let token = process.env.SUPABASE_ACCESS_TOKEN
    if (!token) {
      const { execFileSync } = await import('node:child_process')
      const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w']).toString().trim()
      token = raw.startsWith('go-keyring-base64:') ? Buffer.from(raw.slice(18), 'base64').toString() : raw
    }
    const ref = process.env.SUPABASE_PROJECT_REF ?? 'cbskbnvvgcybmfikxgky'
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/disk/util`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return null
    const m = ((await r.json()) as { metrics?: { fs_size_bytes: number; fs_used_bytes: number } }).metrics
    return m ? (m.fs_used_bytes / m.fs_size_bytes) * 100 : null
  } catch {
    return null
  }
}
function toCsv(ds: ArchiveDecision[]): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = ds.map((d) => d.action === 'load'
    ? [d.site, d.fileName, 'load', '', d.kind, d.label, d.shopNo, d.areaM2, d.channels.map((c) => c.sourceColumn).join(' + '), d.readings]
    : [d.site, d.fileName, 'skip', d.reason, '', '', '', '', d.detail, ''])
  return [['site', 'file', 'action', 'reason', 'kind', 'label', 'shop', 'area_m2', 'channels / detail', 'readings'], ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n'
}

main().catch((e) => { console.error(e); process.exit(1) })
