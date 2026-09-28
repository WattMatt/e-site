#!/usr/bin/env node
// Builds truncated, anonymised golden fixtures for packages/shared/src/meter-data
// from the office meter corpus (read-only). Plan: docs/superpowers/plans/2026-09-28-solar-phase-3a-i-meter-data-library.md Task 2.
//   node scripts/solar/build-meter-fixtures.mjs "/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/006. METER CSV"
// Sources are resolved by pseudonymous reference (see FIXTURES); no real name or serial is in this file.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.argv[2]
if (!ROOT) {
  console.error('usage: node scripts/solar/build-meter-fixtures.mjs "<006. METER CSV folder>"')
  process.exit(2)
}
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '../../packages/shared/src/meter-data/__fixtures__/corpus')

const W = ['2025-03-10', '2025-03-23']
// Each source is named ONLY by its pseudonymous reference (the manifest `source` form):
//   ref = "site-<12 hex sha256(site folder)>/<16 hex sha256(relative path)>.<format>"
// The builder walks the corpus, hashes every relative path and matches. `out` is the final
// (already pseudonymised) fixture name. No real site, tenant or serial is written here.
const FIXTURES = [
  { id: 'a-bulk', ref: 'site-5f847ce9b8e6/370de3d9ba4bcb67.A', out: 'SITE YA, , BULK METER, .csv', fmt: 'A', window: W },
  { id: 'a-tenant', ref: 'site-5f847ce9b8e6/65967c2cc259b7c1.A', out: 'SITE YA, SHOP 050, TENANT-23, 3000.csv', fmt: 'A', window: W },
  { id: 'a-check', ref: 'site-5f847ce9b8e6/4b2d8e46d34aa99d.A', out: 'SITE YA, , CHECK 1, .csv', fmt: 'A', window: W },
  { id: 'a-generator', ref: 'site-5f847ce9b8e6/61180ef155591c2d.A', out: 'SITE YA, , GENERATOR METER, .csv', fmt: 'A', window: ['2025-06-02', '2025-06-15'] },
  { id: 'a-pv-240', ref: 'site-6ecd81568957/f967b4c912e833dc.A', out: 'SITE WR, , SOLAR PLANT 240, .csv', fmt: 'A', window: W },
  { id: 'a-pv-360', ref: 'site-6ecd81568957/31c0a2ae1cc1dd25.A', out: 'SITE WR, , SOLAR PLANT 360, .csv', fmt: 'A', window: W },
  { id: 'a-pv-multi', ref: 'site-02159ab53247/c98ab052191ec032.A', out: 'SITE FV, , Solar, .csv', fmt: 'A', window: W },
  { id: 'a-reactive', ref: 'site-4212b625d081/da2426d13ebd2e58.A', out: 'SITE EV, 220, TENANT-31, 2067.csv', fmt: 'A', window: W },
  { id: 'a-volts-amps', ref: 'site-029eef041a13/34d2e548637b1519.A', out: 'SITE CY, 13, TENANT-41, 45.csv', fmt: 'A', window: W },
  { id: 'a-energy-resets', ref: 'site-1c4f602e91f4/66c44632fbbc713f.A', out: 'SITE OX, , TENANT-51, .csv', fmt: 'A', window: ['2024-10-10', '2024-10-23'] },
  { id: 'a-level-shift', ref: 'site-2b76e0d1cb45/3dd06bb7d4c5f7d1.A', out: 'SITE FW, 89, TENANT-61, 3127.csv', fmt: 'A', window: ['2024-10-06', '2024-10-19'] },
  { id: 'a-hourly-negative', ref: 'site-856f019d84f6/e0e3fe5a81786d35.A', out: 'SITE VW, 12, TENANT-71, 4821.csv', fmt: 'A', window: ['2024-12-27', '2025-01-09'] },
  { id: 'a-tiny-negative', ref: 'site-131e7f7776ca/f704b904e728b979.A', out: 'SITE TH, 3, TENANT-81, 1995.csv', fmt: 'A', window: ['2024-06-03', '2024-06-16'] },
  { id: 'a-empty', ref: 'site-24560dfb48f1/cd0d4c77feaf0e3b.A', out: 'SITE EQ, , DB 37, .csv', fmt: 'A', window: null },
  { id: 'a-short', ref: 'site-d494cbac42f6/54f4fb363b436e90.A', out: 'SITE MO, , TENANT-91, .csv', fmt: 'A', window: null },
  { id: 'a-water', ref: 'site-e3cdcac6991e/83ffb159b5600ae6.A', out: 'SITE BC, , BC1 - TENANT-92, .csv', fmt: 'A', window: null },
  { id: 'a-vacant-1', ref: 'site-7287c42af185/5352acbd3ac56a94.A', out: 'SITE FL, SHOP 06, Vacant, 450 (2).csv', fmt: 'A', window: W },
  { id: 'a-vacant-2', ref: 'site-02159ab53247/caf6617114e62f70.A', out: 'SITE FV, , SHOP 107 VACANT, .csv', fmt: 'A', window: W },
  { id: 'a-twin-of-d', ref: 'site-ce0f452ad0cb/de89b6022ed5ef4a.A', out: 'SITE RP, 27, TENANT-06, 525.csv', fmt: 'A', window: W },
  { id: 'd-escaped', ref: 'site-ce0f452ad0cb/56d9620a95fbb6d1.D', out: 'RP - TENANT-06 525.csv', fmt: 'D', window: W },
  { id: 'b-virtual-calc', ref: 'site-8029679f4046/961ac7e81b1febae.B', out: 'SITE SG, , 30182503_LOCAL MAIN, .csv', fmt: 'B', window: ['2025-10-01', '2025-10-14'] },
  { id: 'b-misfiled', ref: 'site-8029679f4046/d1d8f1a4c7d8ae04.B', out: 'SITE SG, , 32700578_DB-26, .csv', fmt: 'B', window: ['2025-10-01', '2025-10-14'] },
  { id: 'b-shared-body-1', ref: 'site-d830013fc427/fbaeb142f41c3ecc.B', out: 'SITE MR, , Local Main, .csv', fmt: 'B', window: W },
  { id: 'b-shared-body-2', ref: 'site-2d26c699e0b1/1de0cf1b6460a260.B', out: 'SITE TS, 09, DB 09, .csv', fmt: 'B', window: W },
  { id: 'b-halfhourly', ref: 'site-e9cf6a49caa9/1b3f94512446cd32.B', out: 'SITE PM, , Meter 31599070, .csv', fmt: 'B', window: W },
  { id: 'b-daily', ref: 'site-e9cf6a49caa9/6be7a716a603573a.B', out: 'SITE PM, , Meter 39631688, .csv', fmt: 'B', window: W },
  { id: 'b-seven-serials', ref: 'site-d6ffa4c80435/a0e443d32bf1d122.B', out: 'SITE RM, , E9001, .csv', fmt: 'B', window: W },
  { id: 'c-energy', ref: 'site-0465266003ff/428f3d42a50f69c6.C', out: 'SITE TZ, , 01A TENANT-95, .csv', fmt: 'C', window: W },
  { id: 'c-energy-2', ref: 'site-d830013fc427/f2b71faf2094de76.C', out: 'SITE MR, , TENANT-96, .csv', fmt: 'C', window: W },
  { id: 'e-log', ref: 'site-3d3bb3d89d06/8290db891735a460.E', out: 'SITE KM, , E9002, .csv', fmt: 'E', window: null },
  { id: 'f-derived', ref: 'site-b535c62513b1/5460394984734387.F', out: 'SITE PD, , PDB_31815534_TENANT-97_22m2V, .csv', fmt: 'F', window: null },
]
// E-log rows kept beyond the first E_FIRST_ROWS, named by their serial PSEUDONYM (pseudoSerial),
// never by the real serial. The pseudonyms are the ones that appear in the committed fixture.
const E_KEEP_PSEUDO = new Set(['33103528', '38813110', '31599070', '39614362', '34606877'])
const E_FIRST_ROWS = 30
// Site pseudonyms for E-log mall parts, keyed by sha256("esite-site:" + siteKey(name)) (16 hex).
// siteKey() must match packages/shared/src/meter-data/register.ts.
const SITE_BY_KEY_HASH = {
  c6edb4fb87acb4f6: 'SITE PD', d182ab21d8b3203d: 'SITE PM', '13e45e03cbfd8533': 'SITE MR', '94779987cd18e987': 'SITE TZ',
  '3a043102e8313a38': 'SITE TS', e9f508348b46e046: 'SITE RM', '79a8645af3ce2a7c': 'SITE KM', c0bbe82ac3073156: 'SITE SG',
}
const siteByName = (name) => SITE_BY_KEY_HASH[sha256('esite-site:' + siteKey(name)).slice(0, 16)]

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
    if (!(i < E_FIRST_ROWS || E_KEEP_PSEUDO.has(pseudoSerial(serial ?? '')))) return
    n++
    const parts = (name ?? '').split(/\s*;\s*/)
    const anon = parts.map((p, k) => {
      if (k === 0) return `TENANT-E${String(i + 1).padStart(3, '0')}`
      if (/^M?DB\b|^DB\s*-?\d/i.test(p)) return p
      return siteByName(p) ?? 'SITE X'
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
// ref -> relative path, by walking the corpus once (read-only).
function indexCorpus(root) {
  const byRef = new Map()
  for (const site of readdirSync(root, { withFileTypes: true })) {
    if (!site.isDirectory()) continue
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        const rel = relative(root, p).split(sep).join('/')
        for (const fmt of 'ABCDEFG') byRef.set(sourceRef(rel, fmt), rel)
      }
    }
    walk(join(root, site.name))
  }
  return byRef
}

mkdirSync(OUT, { recursive: true })
const manifest = []
const CORPUS = indexCorpus(ROOT)
for (const f of FIXTURES) {
  const rel = CORPUS.get(f.ref)
  if (!rel) throw new Error(`${f.id}: no corpus file matches ${f.ref}`)
  const raw = readFileSync(join(ROOT, rel))
  const text = raw.toString('utf8')
  const built =
    f.fmt === 'D' ? buildEscaped(f, text)
    : f.fmt === 'E' ? buildLog(text)
    : f.fmt === 'F' ? buildDerived(text)
    : buildSeries(f, text)
  const file = f.out
  writeFileSync(join(OUT, file), built.text)
  manifest.push({
    id: f.id, file, format: f.fmt, source: sourceRef(rel, f.fmt), sourceSha256: sha256(raw),
    window: f.window, dataRows: built.dataRows,
    transformation: f.window ? 'rows whose reading day is inside the window, original order, values unchanged; names and serials pseudonymised' : 'whole file or head as listed; names and serials pseudonymised',
  })
  console.log(`${f.id.padEnd(20)} ${String(built.dataRows).padStart(5)}  ${file}`)
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
