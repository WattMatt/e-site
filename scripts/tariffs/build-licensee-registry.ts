/**
 * Builds the reviewed licensee registry data file (owner default 4) from:
 *   (a) the 2025/26 NERSA province workbooks: one licensee per sheet, province
 *       from the workbook, aliases = sheet name + A1 title name;
 *   (b) 2026-27/MUNICIPAL/manifest.csv: province from the folder, the RfD's
 *       licensee name added as an alias (or a new licensee when no sheet).
 * plus the two Eskom licensees. Kinds come from classifyLicensee. The output
 * is a DATA FILE for human review, committed to the repo; the seed script
 * (seed-licensee-registry.ts) loads it, dry-run by default.
 *
 *   TARIFF_SOURCE_DIR="…/005. NERSA TARIFFS" pnpm exec tsx scripts/tariffs/build-licensee-registry.ts
 *
 * Re-running overwrites scripts/tariffs/data/licensee-registry.json from the
 * same sources. Corrections live in the maps below, not in the JSON.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { parseTitle } from '../../packages/shared/src/tariffs/parsers/amount.ts'
import { cellValueFromExcel } from '../../packages/shared/src/tariffs/parsers/grid.ts'
import { normaliseAlias } from '../../packages/shared/src/tariffs/ingest/ingest-core.ts'
import { classifyLicensee, validateRegistry, type Province, type RegistryEntry } from '../../packages/shared/src/tariffs/ingest/registry.ts'

const SRC = process.env.TARIFF_SOURCE_DIR
if (!SRC) {
  console.error('Set TARIFF_SOURCE_DIR to the "005. NERSA TARIFFS" folder.')
  process.exit(1)
}
const OUT = resolve(import.meta.dirname, 'data/licensee-registry.json')

const WORKBOOKS: [string, Province][] = [
  ['Eastern-Cape-Province.xlsx', 'EC'], ['Free-State-Province.xlsx', 'FS'], ['Gauteng-Province.xlsx', 'GP'],
  ['Kwa-Zulu-Natal-Province.xlsx', 'KZN'], ['Limpopo-Province.xlsx', 'LP'], ['Mpumalanga-Province.xlsx', 'MP'],
  ['North-West-Province.xlsx', 'NW'], ['Northern-Cape-Province.xlsx', 'NC'], ['Western-Cape-Province1.xlsx', 'WC'],
]
const FOLDER_PROVINCE: Record<string, Province> = {
  'Eastern Cape': 'EC', 'Free State': 'FS', Gauteng: 'GP', 'KwaZulu-Natal': 'KZN', Limpopo: 'LP',
  Mpumalanga: 'MP', 'North West': 'NW', 'Northern Cape': 'NC', 'Western Cape': 'WC',
}

/** Canonical names for misspelt or truncated sheet tabs (as-is/09 §2.3). Keyed by the normalised sheet name. */
const CANONICAL: Record<string, string> = {
  'MODALE CITY': 'MOGALE CITY',
  'NELSON MANDELLA BAY METRO': 'NELSON MANDELA BAY METRO',
  LANGERBERG: 'LANGEBERG',
  DRANKENSTEIN: 'DRAKENSTEIN',
  KAREENBERG: 'KAREEBERG',
  'WALTER SIZULU': 'WALTER SISULU',
  'CITY OF CAPE': 'CITY OF CAPE TOWN',
  // The Mangaung metro's sheet; Kopanong has its own "CENTLEC - KOPANONG" sheet and RfD (COVERAGE.md).
  'CENTLEC MANGAUNG (KOPANONG)': 'CENTLEC (MANGAUNG)',
  'VLEES BAAI': 'VLEESBAAI DIENSTE',
}

/** Other names a licensee is known by (owner default 4 metro list). Keyed by the normalised sheet name. */
const EXTRA_ALIASES: Record<string, string[]> = {
  'CITY POWER': ['CITY OF JOHANNESBURG'],
  'CENTLEC MANGAUNG (KOPANONG)': ['MANGAUNG', 'CENTLEC'],
}

/** Where the filed province is not the licence area (COVERAGE.md; as-is/09 §2.3). */
const PROVINCE_OVERRIDE: Record<string, { province: Province; note: string }> = {
  'SASOL SYNFUELS': { province: 'MP', note: 'filed under KZN in the 2025/26 workbook; licence area is Secunda (Mpumalanga)' },
  SASOLBURG: { province: 'FS', note: 'filed under KZN in the 2025/26 workbook; licence area is Sasolburg (Free State)' },
}

/** Manifest licensee names that differ from their 2025/26 sheet tab: manifest -> sheet (normalised). */
const MANIFEST_TO_SHEET: Record<string, string> = {}

interface Draft extends RegistryEntry {
  sources: { sheet2025?: string; workbook?: string; titleName?: string; rfd2026?: string[] }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' } else if (ch !== '\r') field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  const [head, ...body] = rows
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])))
}

async function main(): Promise<void> {
  const drafts = new Map<string, Draft>() // keyed by normalised sheet name
  const sources: Record<string, string> = {}
  const notes: string[] = []

  for (const [file, province] of WORKBOOKS) {
    const path = join(SRC as string, '2025', file)
    sources[`2025/${file}`] = sha256(path)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(path)
    for (const ws of wb.worksheets) {
      const sheetKey = normaliseAlias(ws.name)
      if (sheetKey === '') continue
      const title = parseTitle(cellValueFromExcel(ws.getCell(1, 1).value), cellValueFromExcel(ws.getCell(1, 2).value))
      const name = CANONICAL[sheetKey] ?? sheetKey
      const override = PROVINCE_OVERRIDE[sheetKey]
      const aliases = [sheetKey, normaliseAlias(name), ...(EXTRA_ALIASES[sheetKey] ?? [])]
      const titleAlias = normaliseAlias(title.name)
      if (titleAlias !== '' && titleAlias.length <= 80) aliases.push(titleAlias)
      drafts.set(sheetKey, {
        name, kind: classifyLicensee(sheetKey), province: override?.province ?? province,
        aliases: [...new Set(aliases)], notes: override?.note ?? null,
        sources: { sheet2025: ws.name, workbook: file, titleName: title.name || undefined },
      })
    }
  }

  const manifestPath = join(SRC as string, '2026-27/MUNICIPAL/manifest.csv')
  sources['2026-27/MUNICIPAL/manifest.csv'] = sha256(manifestPath)
  const aliasIndex = (): Map<string, Draft> => {
    const m = new Map<string, Draft>()
    for (const d of drafts.values()) for (const a of d.aliases) m.set(a, d)
    return m
  }
  for (const row of parseCsv(readFileSync(manifestPath, 'utf8'))) {
    const lic = normaliseAlias(row.licensee)
    const index = aliasIndex()
    const hit = index.get(lic) ?? (MANIFEST_TO_SHEET[lic] ? drafts.get(MANIFEST_TO_SHEET[lic]) : undefined)
    const folderProvince = FOLDER_PROVINCE[row.province]
    if (hit) {
      if (!hit.aliases.includes(lic)) hit.aliases.push(lic)
      hit.sources.rfd2026 = [...(hit.sources.rfd2026 ?? []), row.filename]
      if (folderProvince && hit.province !== folderProvince && !PROVINCE_OVERRIDE[normaliseAlias(hit.sources.sheet2025 ?? '')]) {
        notes.push(`${hit.name}: 2025/26 workbook says ${hit.province}, 2026/27 folder says ${folderProvince}`)
      }
      continue
    }
    const name = CANONICAL[lic] ?? lic
    notes.push(`manifest licensee "${row.licensee}" has no 2025/26 sheet: new entry`)
    drafts.set(lic, {
      name, kind: classifyLicensee(lic), province: PROVINCE_OVERRIDE[lic]?.province ?? folderProvince ?? null,
      aliases: [...new Set([lic, normaliseAlias(name)])], notes: '2026/27 RfD only (no 2025/26 compendium sheet)',
      sources: { rfd2026: [row.filename] },
    })
  }

  const entries: Draft[] = [
    {
      name: 'Eskom', kind: 'eskom', province: 'national', aliases: ['ESKOM', 'ESKOM HOLDINGS SOC LTD', 'ESKOM (NON-LOCAL AUTHORITY)'],
      notes: 'Direct (non-local-authority) tariffs; 1 April financial year', sources: {},
    },
    {
      name: 'Eskom (Local Authority tariffs)', kind: 'eskom', province: 'national',
      aliases: ['ESKOM (LOCAL AUTHORITY TARIFFS)', 'ESKOM LOCAL AUTHORITY'],
      notes: 'Eskom tariffs to municipalities (the "Munic" sheets); own 1 April year (owner default 5)', sources: {},
    },
    ...[...drafts.values()].sort((a, b) => (a.province ?? '').localeCompare(b.province ?? '') || a.name.localeCompare(b.name)),
  ]

  // A title alias that another licensee also claims is ambiguous: drop it from both, and say so.
  const claims = new Map<string, Draft[]>()
  for (const e of entries) for (const a of e.aliases) claims.set(a, [...(claims.get(a) ?? []), e])
  for (const [alias, owners] of claims) {
    if (owners.length < 2) continue
    for (const o of owners) {
      if (normaliseAlias(o.sources.sheet2025 ?? '') === alias || normaliseAlias(o.name) === alias) continue
      o.aliases = o.aliases.filter((x) => x !== alias)
      notes.push(`alias "${alias}" dropped from ${o.name} (also claimed by ${owners.filter((x) => x !== o).map((x) => x.name).join(', ')})`)
    }
  }

  const problems = validateRegistry(entries)
  if (problems.length > 0) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  mkdirSync(resolve(OUT, '..'), { recursive: true })
  const out = {
    description: 'Curated tariff licensee registry (owner default 4). Generated by build-licensee-registry.ts; reviewed by a human before seeding.',
    generated_from: sources,
    review_notes: notes,
    entries: entries.map(({ sources: s, ...e }) => ({ ...e, sources: s })),
  }
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)
  const byKind = entries.reduce<Record<string, number>>((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {})
  console.log(`${entries.length} licensees ${JSON.stringify(byKind)}; ${notes.length} review notes -> ${OUT}`)
  for (const n of notes) console.log(`  note: ${n}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
