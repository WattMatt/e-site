#!/usr/bin/env node
// Builds truncated, anonymised golden fixtures for packages/shared/src/meter-data
// from the office meter corpus (read-only). Plan: docs/superpowers/plans/2026-09-28-solar-phase-3a-i-meter-data-library.md Task 2.
//   node scripts/solar/build-meter-fixtures.mjs "/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/006. METER CSV"
// Source names below already appear in docs/solar/as-is/10-meter-csv-source.md; the OUTPUT files carry none of them.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.argv[2]
if (!ROOT) {
  console.error('usage: node scripts/solar/build-meter-fixtures.mjs "<006. METER CSV folder>"')
  process.exit(2)
}
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '../../packages/shared/src/meter-data/__fixtures__/corpus')

const W = ['2025-03-10', '2025-03-23']
const FIXTURES = [
  { id: 'a-bulk', src: 'YARONA/YARONA, , BULK METER, .csv', out: 'SITE YA, , BULK METER, .csv', fmt: 'A', window: W },
  { id: 'a-tenant', src: 'YARONA/YARONA, SHOP 050, SHOPRITE, 3000.csv', out: 'SITE YA, SHOP 050, TENANT-23, 3000.csv', fmt: 'A', window: W },
  { id: 'a-check', src: 'YARONA/YARONA, , CHECK 1, .csv', out: 'SITE YA, , CHECK 1, .csv', fmt: 'A', window: W },
  { id: 'a-generator', src: 'YARONA/YARONA, , GENERATOR METER, .csv', out: 'SITE YA, , GENERATOR METER, .csv', fmt: 'A', window: ['2025-06-02', '2025-06-15'] },
  { id: 'a-pv-240', src: 'WHITE RIVER/WHITE RIVER, , SOLAR PLANT 240, .csv', out: 'SITE WR, , SOLAR PLANT 240, .csv', fmt: 'A', window: W },
  { id: 'a-pv-360', src: 'WHITE RIVER/WHITE RIVER, , SOLAR PLANT 360, .csv', out: 'SITE WR, , SOLAR PLANT 360, .csv', fmt: 'A', window: W },
  { id: 'a-pv-multi', src: 'Fourways Value Mart/Fourways Value Mart, , Solar, .csv', out: 'SITE FV, , Solar, .csv', fmt: 'A', window: W },
  { id: 'a-reactive', src: 'Evaton/Evaton, 220, BOXER SUPERSTORES, 2067.csv', out: 'SITE EV, 220, TENANT-31, 2067.csv', fmt: 'A', window: W },
  { id: 'a-volts-amps', src: "CITY CENTRE YORK/CITY CENTRE YORK, 13, REMY'S CLOTHING, 45.csv", out: 'SITE CY, 13, TENANT-41, 45.csv', fmt: 'A', window: W },
  { id: 'a-energy-resets', src: '204 Oxford/204 Oxford, , NAKED COFFEE, .csv', out: 'SITE OX, , TENANT-51, .csv', fmt: 'A', window: ['2024-10-10', '2024-10-23'] },
  { id: 'a-level-shift', src: 'FLAMWOOD WALK/FLAMWOOD WALK, 89, Checkers, 3127.csv', out: 'SITE FW, 89, TENANT-61, 3127.csv', fmt: 'A', window: ['2024-10-06', '2024-10-19'] },
  { id: 'a-hourly-negative', src: 'VILLAGE WALK/VILLAGE WALK, 12, SHOPRITE CHECKERS, 4821.csv', out: 'SITE VW, 12, TENANT-71, 4821.csv', fmt: 'A', window: ['2024-12-27', '2025-01-09'] },
  { id: 'a-tiny-negative', src: 'THAMBI/THAMBI, 3, Pick n Pay, 1995.csv', out: 'SITE TH, 3, TENANT-81, 1995.csv', fmt: 'A', window: ['2024-06-03', '2024-06-16'] },
  { id: 'a-empty', src: 'EQUINOX/EQUINOX, , DB 37, .csv', out: 'SITE EQ, , DB 37, .csv', fmt: 'A', window: null },
  { id: 'a-short', src: 'MORONE (KAPANE) - KSC/MORONE (KAPANE) - KSC, , BEARES, .csv', out: 'SITE MO, , TENANT-91, .csv', fmt: 'A', window: null },
  { id: 'a-water', src: "BIYELA CENTRE/BIYELA CENTRE, , BC1 - MICY'S CHANNEL BOUTIQE, .csv", out: 'SITE BC, , BC1 - TENANT-92, .csv', fmt: 'A', window: null },
  { id: 'a-vacant-1', src: 'FLAMWOOD VALUE/FLAMWOOD VALUE, SHOP 06, Vacant, 450 (2).csv', out: 'SITE FL, SHOP 06, Vacant, 450 (2).csv', fmt: 'A', window: W },
  { id: 'a-vacant-2', src: 'Fourways Value Mart/Fourways Value Mart, , SHOP 107 VACANT, .csv', out: 'SITE FV, , SHOP 107 VACANT, .csv', fmt: 'A', window: W },
  { id: 'a-twin-of-d', src: 'RUSTENBURG PLAZA/RUSTENBURG PLAZA, 27, ABSA BANK LIMITED, 525.csv', out: 'SITE RP, 27, TENANT-06, 525.csv', fmt: 'A', window: W },
  { id: 'd-escaped', src: 'RUSTENBURG PLAZA/_consolidated/RP - ABSA 525.csv', out: 'RP - TENANT-06 525.csv', fmt: 'D', window: W },
  { id: 'b-virtual-calc', src: 'SEGONYANA/SEGONYANA, , 36724754_LOCAL MAIN, .csv', out: 'SITE SG, , {36724754}_LOCAL MAIN, .csv', fmt: 'B', window: ['2025-10-01', '2025-10-14'] },
  { id: 'b-misfiled', src: 'SEGONYANA/SEGONYANA, , 36338822_DB-26, .csv', out: 'SITE SG, , {36338822}_DB-26, .csv', fmt: 'B', window: ['2025-10-01', '2025-10-14'] },
  { id: 'b-shared-body-1', src: 'MERINO MALL/MERINO MALL, , Local Main, .csv', out: 'SITE MR, , Local Main, .csv', fmt: 'B', window: W },
  { id: 'b-shared-body-2', src: 'TOWN SQUARE/TOWN SQUARE, 09, DB 09, .csv', out: 'SITE TS, 09, DB 09, .csv', fmt: 'B', window: W },
  { id: 'b-halfhourly', src: 'PRINCESS MKABAYI MALL/PRINCESS MKABAYI MALL, , Meter 35575535, .csv', out: 'SITE PM, , Meter {35575535}, .csv', fmt: 'B', window: W },
  { id: 'b-daily', src: 'PRINCESS MKABAYI MALL/PRINCESS MKABAYI MALL, , Meter 36084823, .csv', out: 'SITE PM, , Meter {36084823}, .csv', fmt: 'B', window: W },
  { id: 'b-seven-serials', src: 'RUSTENBURG MALL/RUSTENBURG MALL, , E0400, .csv', out: 'SITE RM, , E0400, .csv', fmt: 'B', window: W },
  { id: 'c-energy', src: 'THABAZIMBI/THABAZIMBI, , 01A Panarottis, .csv', out: 'SITE TZ, , 01A TENANT-95, .csv', fmt: 'C', window: W },
  { id: 'c-energy-2', src: 'MERINO MALL/MERINO MALL, , Checkers, .csv', out: 'SITE MR, , TENANT-96, .csv', fmt: 'C', window: W },
  { id: 'e-log', src: 'KURUMAN MALL/KURUMAN MALL, , E2495, .csv', out: 'SITE KM, , E2495, .csv', fmt: 'E', window: null },
  { id: 'f-derived', src: 'PARKDENE/PARKDENE, , PDB_36506619_KFCDT_22m2V, .csv', out: 'SITE PD, , PDB_{36506619}_TENANT-97_22m2V, .csv', fmt: 'F', window: null },
]
const E_KEEP_SERIALS = new Set(['36506625', '36339816', '35575535', '33883284', '36339326'])
const E_FIRST_ROWS = 30
// Keys produced by siteKey() (must match packages/shared/src/meter-data/register.ts).
const SITE_BY_KEY = {
  PARKDENE: 'SITE PD', PRINCESSMKABAYI: 'SITE PM', MERINO: 'SITE MR', THABAZIMBI: 'SITE TZ',
  TOWN: 'SITE TS', RUSTENBURG: 'SITE RM', KURUMAN: 'SITE KM', SEGONYANA: 'SITE SG',
}

function siteKey(s) {
  const words = String(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  while (words.length > 1 && ['MALL', 'SQUARE', 'CENTRE', 'CENTER', 'PLAZA', 'SHOPPING'].includes(words[words.length - 1])) words.pop()
  return words.join('')
}
function pseudoSerial(real) {
  const m = /^(\d+)([A-Z]?)$/.exec(real.trim())
  if (!m) return real
  const h = createHash('sha256').update('esite-meter-fixture:' + m[1]).digest('hex').slice(0, 12)
  return '3' + (BigInt('0x' + h) % 10000000n).toString().padStart(7, '0') + m[2]
}
function outName(name) {
  return name.replace(/\{(\d+)\}/g, (_, d) => pseudoSerial(d))
}
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}
function splitKeepingEol(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const endsWithEol = text.endsWith('\n')
  const lines = text.split(/\r?\n/)
  if (endsWithEol) lines.pop()
  return { lines, eol, endsWithEol }
}
function joinLines(lines, eol, endsWithEol) {
  return lines.join(eol) + (endsWithEol ? eol : '')
}
// Reading day: A = label date (interval-beginning); B/C = date of (label - 1 s).
function dayOfA(line) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) /.exec(line)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
function dayOfEnding(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(timeStr.trim())
  if (!d || !t) return null
  const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]) - 1000
  return new Date(ms).toISOString().slice(0, 10)
}
function dayOfB(line) {
  const cells = line.split(',').map((c) => c.trim())
  return dayOfEnding(cells[cells.length - 3] ?? '', cells[cells.length - 2] ?? '')
}
function dayOfC(line) {
  const [dt] = line.split(',')
  const [date, time] = (dt ?? '').trim().split(' ')
  return dayOfEnding(date ?? '', time ?? '')
}
const inWindow = (day, w) => day !== null && day >= w[0] && day <= w[1]

function anonymisePreamble(line) {
  // "pnpscada.com", "3xxxxxxx", ... (B)  or  pnpscada.com,3xxxxxxx (C)
  return line.replace(/(\d{7,8}[A-Z]?)/g, (s) => pseudoSerial(s))
}

function buildSeries(f, text) {
  const { lines, eol, endsWithEol } = splitKeepingEol(text)
  if (!f.window) return { text, dataRows: Math.max(0, lines.filter((l) => l.trim() !== '').length - (f.fmt === 'A' ? 2 : 2)) }
  const pre = f.fmt === 'A' ? lines.slice(0, 3) : [anonymisePreamble(lines[0]), lines[1]]
  const body = lines.slice(pre.length).filter((l) => l.trim() !== '')
  const dayOf = f.fmt === 'A' ? dayOfA : f.fmt === 'B' ? dayOfB : dayOfC
  const kept = body.filter((l) => inWindow(dayOf(l), f.window))
  return { text: joinLines([...pre, ...kept], eol, endsWithEol), dataRows: kept.length }
}
function buildEscaped(f, text) {
  const trailing = text.endsWith('\n') ? '\n' : ''
  const recs = text.replace(/\n$/, '').split('\\n')
  const kept = recs.slice(2).filter((r) => r.trim() !== '' && inWindow(dayOfA(r), f.window))
  return { text: [recs[0], recs[1], ...kept].join('\\n') + trailing, dataRows: kept.length }
}
function buildLog(text) {
  const { lines, eol, endsWithEol } = splitKeepingEol(text)
  const out = [lines[0]]
  let n = 0
  lines.slice(1).forEach((l, i) => {
    const [serial, name, downloaded, ts] = l.split(',')
    if (!(i < E_FIRST_ROWS || E_KEEP_SERIALS.has(serial))) return
    n++
    const parts = (name ?? '').split(/\s*;\s*/)
    const anon = parts.map((p, k) => {
      if (k === 0) return `TENANT-E${String(i + 1).padStart(3, '0')}`
      if (/^M?DB\b|^DB\s*-?\d/i.test(p)) return p
      return SITE_BY_KEY[siteKey(p)] ?? 'SITE X'
    })
    out.push([pseudoSerial(serial), anon.join(' ; '), downloaded ?? '', ts ?? ''].join(','))
  })
  return { text: joinLines(out, eol, endsWithEol), dataRows: n }
}
function buildDerived(text) {
  const { lines, eol, endsWithEol } = splitKeepingEol(text)
  const kept = lines.slice(0, 25)
  return { text: joinLines(kept, eol, endsWithEol && kept.length === lines.length), dataRows: kept.length - 1 }
}

// The manifest never carries a real source path (it would re-identify the fixtures: mall, tenant
// and real meter serials). `source` = "site-<12 hex of sha256(site folder)>/<16 hex of
// sha256(relative path)>.<format letter>". The content sha256 (sourceSha256) is kept, so
// provenance can still be verified locally against the corpus.
function sourceRef(rel, fmt) {
  const site = rel.split('/')[0]
  return `site-${sha256(site).slice(0, 12)}/${sha256(rel).slice(0, 16)}.${fmt}`
}

mkdirSync(OUT, { recursive: true })
const manifest = []
for (const f of FIXTURES) {
  const raw = readFileSync(join(ROOT, f.src))
  const text = raw.toString('utf8')
  const built =
    f.fmt === 'D' ? buildEscaped(f, text)
    : f.fmt === 'E' ? buildLog(text)
    : f.fmt === 'F' ? buildDerived(text)
    : buildSeries(f, text)
  const file = outName(f.out)
  writeFileSync(join(OUT, file), built.text)
  manifest.push({
    id: f.id, file, format: f.fmt, source: sourceRef(f.src, f.fmt), sourceSha256: sha256(raw),
    window: f.window, dataRows: built.dataRows,
    transformation: f.window ? 'rows whose reading day is inside the window, original order, values unchanged; names and serials pseudonymised' : 'whole file or head as listed; names and serials pseudonymised',
  })
  console.log(`${f.id.padEnd(20)} ${String(built.dataRows).padStart(5)}  ${file}`)
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
