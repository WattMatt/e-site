#!/usr/bin/env node --experimental-strip-types
/**
 * Read-only acceptance run for floor-plan label detection (spec 2026-10-21, Task 9).
 * =========================================================================
 * For each tenant-layout sheet: download its PDF, read the page's text layer
 * the way the browser does (pdf.js at scale 2), detect the SHOP labels, review
 * them against the schedule and the shapes already drawn on the sheet, and
 * print the counts. With --fill, rasterise the same page at 2 px/pt and run the
 * suggested-outline fill + gate on every `draw` row.
 *
 * WRITES NOTHING to the database or storage. The service role key is used only
 * to read tenants.status_plan_sheets / status_plans / status_plan_shapes,
 * structure.nodes, and to download the sheet PDF from the private bucket
 * `tenant-plan-files`. The key is read from the environment and never printed.
 *
 * Requirements:
 *   - poppler's `pdftoppm` on PATH (only with --fill): the page is rasterised
 *     with `pdftoppm -r 144 -gray` (144 dpi = the app's 2 px per PDF point),
 *     because no Node canvas / PNG decoder resolves from apps/web.
 *   - SUPABASE_SERVICE_ROLE_KEY in the environment (the "Service role" line of
 *     esite/.secrets/supabase.md). SUPABASE_URL is optional (defaults to prod).
 *
 * Usage (from the repo root). `node --experimental-strip-types` cannot resolve
 * the extensionless imports inside @esite/shared, so run it with tsx:
 *   pnpm --filter web exec tsx scripts/status-plans/shop-labels-acceptance.ts \
 *     --sheet <sheet-id> [--sheet <sheet-id> …] [--fill] [--tmp <dir>]
 *
 * --tmp: where the downloaded PDF and the PGM raster go (default: a fresh
 * directory under the OS temp dir). Nothing is written inside the repo.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectShopLabels,
  isTagShaped,
  reviewShopLabels,
  SHOP_LABEL_RE,
  shopReviewSummary,
  SHOP_ROW_STATES,
  type ShopReview,
  type ShopReviewNode,
  type ShopReviewShape,
} from '@esite/shared/status-plans'
import { extractPageText, type PdfjsModule } from '../../src/lib/status-plans/extract-page-text'
import { fillFromAnchor, gateSuggestion, inkMaskFromImageData, GATE_BAND, GROW_PX, type InkMask } from '../../src/lib/status-plans/fill-outline'

const URL_BASE = process.env.SUPABASE_URL ?? 'https://cbskbnvvgcybmfikxgky.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const BUCKET = 'tenant-plan-files'

const legacy = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule

// ── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const sheets: string[] = []
  let fill = false
  let tmp: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--sheet') sheets.push(argv[++i] ?? '')
    else if (a === '--fill') fill = true
    else if (a === '--tmp') tmp = argv[++i] ?? null
    else throw new Error(`Unknown argument: ${a}`)
  }
  if (sheets.length === 0 || sheets.some((s) => !/^[0-9a-f-]{36}$/i.test(s))) {
    throw new Error('Pass at least one --sheet <uuid>.')
  }
  return { sheets, fill, tmp }
}

// ── Reads (GET only) ──────────────────────────────────────────────────────────

function headers(profile?: string): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${KEY}`, apikey: KEY }
  if (profile) h['Accept-Profile'] = profile
  return h
}

async function getRows<T>(profile: string, table: string, query: string): Promise<T[]> {
  const out: T[] = []
  const page = 1000
  for (let offset = 0; ; offset += page) {
    const res = await fetch(`${URL_BASE}/rest/v1/${table}?${query}&limit=${page}&offset=${offset}`, { method: 'GET', headers: headers(profile) })
    if (!res.ok) throw new Error(`GET ${profile}.${table}: HTTP ${res.status} ${await res.text()}`)
    const rows = (await res.json()) as T[]
    out.push(...rows)
    if (rows.length < page) return out
  }
}

async function download(path: string): Promise<Uint8Array> {
  const enc = path.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${enc}`, { method: 'GET', headers: headers() })
  if (!res.ok) throw new Error(`download ${path}: HTTP ${res.status} ${await res.text()}`)
  return new Uint8Array(await res.arrayBuffer())
}

interface SheetRow { id: string; status_plan_id: string; file_path: string; page_index: number; pixels_per_meter: number | string | null; replaced_at: string | null }
interface PlanRow { id: string; project_id: string; purpose: string }
interface ShapeRow { id: string; shape: string; points: unknown; node_id: string | null; area_type: string | null }
interface NodeRow { id: string; code: string | null; kind: string; shop_number: string | null; shop_name: string | null; name: string | null; shop_area_m2: number | string | null; status: string | null }

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Every SHOP run in the raw text layer, at any angle, with its direction on the raster in degrees.
 * The detector reads every run (allTextItemsToImageSpace in text-space.ts); this independent count is
 * the yardstick for anything it still missed.
 */
async function rawShopRuns(bytes: Uint8Array, pageIndex: number): Promise<Array<{ tag: string; deg: number }>> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (o: Record<string, unknown>) => { promise: Promise<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { transform: number[] }; getTextContent: () => Promise<{ items: unknown[] }> }>; destroy: () => Promise<void> }> }
  }
  const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, verbosity: 0 }).promise
  try {
    const page = await doc.getPage(pageIndex)
    const v = page.getViewport({ scale: 2 }).transform
    const out: Array<{ tag: string; deg: number }> = []
    for (const it of (await page.getTextContent()).items as Array<{ str?: string; transform?: number[] }>) {
      const m = typeof it.str === 'string' ? SHOP_LABEL_RE.exec(it.str.replace(/\s+/g, ' ').trim()) : null
      if (!m || !isTagShaped(m[1]!) || !it.transform) continue // "SHOPRITE" is a word, not a label
      const [a, b] = it.transform as [number, number]
      const deg = Math.round((Math.atan2(v[1]! * a + v[3]! * b, v[0]! * a + v[2]! * b) * 180) / Math.PI)
      out.push({ tag: m[1]!, deg })
    }
    return out
  } finally {
    await doc.destroy()
  }
}

// ── Raster (poppler) ──────────────────────────────────────────────────────────

/** Binary PGM (P5, maxval 255), comment lines tolerated. */
function parsePgm(buf: Buffer): { width: number; height: number; grey: Uint8Array } {
  let pos = 0
  const tokens: string[] = []
  while (tokens.length < 4) {
    // Skip whitespace and comments.
    while (pos < buf.length) {
      const c = buf[pos]
      if (c === 0x23) { while (pos < buf.length && buf[pos] !== 0x0a) pos++ } else if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) pos++
      else break
    }
    let tok = ''
    while (pos < buf.length && ![0x20, 0x0a, 0x0d, 0x09].includes(buf[pos]!)) tok += String.fromCharCode(buf[pos++]!)
    tokens.push(tok)
  }
  pos++ // the single whitespace byte after maxval
  const [magic, w, h, max] = tokens
  if (magic !== 'P5' || max !== '255') throw new Error(`Unsupported PGM header: ${tokens.join(' ')}`)
  const width = Number(w)
  const height = Number(h)
  const grey = new Uint8Array(buf.buffer, buf.byteOffset + pos, width * height)
  if (grey.length !== width * height) throw new Error('PGM shorter than its header says')
  return { width, height, grey }
}

function rasterise(pdfPath: string, pageIndex: number, outBase: string) {
  execFileSync('pdftoppm', ['-r', '144', '-gray', '-singlefile', '-f', String(pageIndex), '-l', String(pageIndex), pdfPath, outBase])
  return parsePgm(readFileSync(`${outBase}.pgm`))
}

function maskFromGrey(g: { width: number; height: number; grey: Uint8Array }): InkMask {
  const n = g.width * g.height
  const data = new Uint8ClampedArray(n * 4)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = g.grey[i]!
    data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255
  }
  return inkMaskFromImageData({ width: g.width, height: g.height, data })
}

// ── Printing ──────────────────────────────────────────────────────────────────

function table(head: string[], rows: string[][]) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (r: string[]) => `| ${r.map((c, i) => (c ?? '').padEnd(w[i]!)).join(' | ')} |`
  console.log(line(head))
  console.log(`|${w.map((x) => '-'.repeat(x + 2)).join('|')}|`)
  for (const r of rows) console.log(line(r))
}

const f1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1))

/** Shortest distance from a point to a closed ring's edges (0 when it lies on an edge). */
function distanceToRing(px: number, py: number, pts: readonly number[]): number {
  let best = Infinity
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const ax = pts[2 * i]!, ay = pts[2 * i + 1]!
    const bx = pts[2 * ((i + 1) % n)]!, by = pts[2 * ((i + 1) % n) + 1]!
    const vx = bx - ax, vy = by - ay
    const len2 = vx * vx + vy * vy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2))
    best = Math.min(best, Math.hypot(px - (ax + t * vx), py - (ay + t * vy)))
  }
  return best
}

// ── One sheet ─────────────────────────────────────────────────────────────────

async function runSheet(sheetId: string, fill: boolean, tmp: string) {
  const [sheet] = await getRows<SheetRow>('tenants', 'status_plan_sheets', `id=eq.${sheetId}&select=id,status_plan_id,file_path,page_index,pixels_per_meter,replaced_at`)
  if (!sheet) throw new Error(`No sheet ${sheetId}`)
  const [plan] = await getRows<PlanRow>('tenants', 'status_plans', `id=eq.${sheet.status_plan_id}&select=id,project_id,purpose`)
  if (!plan) throw new Error(`No plan for sheet ${sheetId}`)
  const shapeRows = await getRows<ShapeRow>('tenants', 'status_plan_shapes', `sheet_id=eq.${sheetId}&select=id,shape,points,node_id,area_type&order=id`)
  const nodeRows = await getRows<NodeRow>('structure', 'nodes', `project_id=eq.${plan.project_id}&kind=eq.tenant_db&deleted_at=is.null&select=id,code,kind,shop_number,shop_name,name,shop_area_m2,status&order=id`)

  const nodes: ShopReviewNode[] = nodeRows.map((n) => ({
    id: n.id,
    kind: n.kind,
    code: n.code ?? null,
    shop_number: n.shop_number ?? null,
    name: n.shop_name ?? n.name ?? null,
    scheduledM2: num(n.shop_area_m2),
    decommissioned: n.status === 'decommissioned',
  }))
  const shapes: ShopReviewShape[] = shapeRows
    .filter((s) => Array.isArray(s.points))
    .map((s) => ({ id: s.id, points: s.points as number[], nodeId: s.node_id, areaType: s.area_type }))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const shapeById = new Map(shapes.map((s) => [s.id, s]))
  const ppm = num(sheet.pixels_per_meter)

  const bytes = await download(sheet.file_path)
  const pdfPath = join(tmp, `${sheetId}.pdf`)
  writeFileSync(pdfPath, bytes)
  const page = await extractPageText({ data: bytes.slice() }, Number(sheet.page_index), legacy)
  if (!page.ok) throw new Error(`text layer: ${page.error}`)
  const labels = detectShopLabels(page.allItems)
  const review: ShopReview = reviewShopLabels({ labels, nodes, shapes, replaced: sheet.replaced_at !== null })

  console.log(`\n## Sheet ${sheetId}`)
  console.log(`purpose ${plan.purpose} · page ${sheet.page_index} · ${(bytes.length / 1024).toFixed(0)} KiB · viewport ${page.width}×${page.height} px · pixels_per_meter ${ppm ?? '—'}`)
  console.log(`tenants ${nodes.length} (live ${nodes.filter((n) => !n.decommissioned).length}) · shapes ${shapes.length} (linked ${shapes.filter((s) => s.nodeId).length}, typed areas ${shapes.filter((s) => s.areaType).length}) · labels ${labels.labels.length}\n`)
  table(['state', 'count'], SHOP_ROW_STATES.map((s) => [s, String(review.counts[s])]))
  console.log(`\nSummary: ${shopReviewSummary(review)}`)
  console.log(`Unlabelled shapes: ${review.unlabelled.length}`)

  // Coverage: SHOP runs in the text layer at any angle against the labels the detector returned.
  const runs = await rawShopRuns(bytes.slice(), Number(sheet.page_index))
  const detected = new Map<string, number>()
  for (const l of labels.labels) detected.set(l.tag.toUpperCase(), (detected.get(l.tag.toUpperCase()) ?? 0) + 1)
  const missed = runs.filter((r) => {
    const k = r.tag.toUpperCase()
    const left = detected.get(k) ?? 0
    if (left > 0) { detected.set(k, left - 1); return false }
    return true
  })
  const byAngle = runs.reduce<Record<string, number>>((acc, r) => ((acc[`${r.deg}°`] = (acc[`${r.deg}°`] ?? 0) + 1), acc), {})
  console.log(`Coverage: ${runs.length} SHOP runs in the text layer (by direction: ${Object.entries(byAngle).map(([k, n]) => `${k} ${n}`).join(', ')}); ${labels.labels.length} detected; ${missed.length} not read`)
  if (missed.length > 0) console.log(`  not read: ${missed.map((r) => `SHOP ${r.tag} @${r.deg}°`).join(', ')}`)

  const tagOfNode = (id: string | null | undefined) => {
    const n = id ? nodeById.get(id) : undefined
    return n ? `${n.shop_number ?? n.code ?? '?'} (${n.name ?? '—'})` : '—'
  }
  const attention = review.rows.filter((r) => r.state === 'conflict' || r.state === 'linked_outside' || r.state === 'not_on_schedule' || r.state === 'needs_you' || r.state === 'moved')
  if (attention.length > 0) {
    console.log('\nRows needing an explanation:\n')
    table(
      ['state', 'label', 'name on drawing', 'anchor px', 'matched tenant', 'row shape → linked to', 'label to that shape', 'other shape', 'reason'],
      attention.map((r) => {
        const holder = r.shapeId ? shapeById.get(r.shapeId) : undefined
        const d = holder ? distanceToRing(r.label.anchor.x, r.label.anchor.y, holder.points) : null
        return [
          r.state,
          `SHOP ${r.label.tag}`,
          r.label.name ?? '—',
          `${r.label.anchor.x.toFixed(0)},${r.label.anchor.y.toFixed(0)}`,
          tagOfNode(r.nodeId),
          holder ? `${holder.id.slice(0, 8)} → ${tagOfNode(holder.nodeId)}` : '—',
          d == null ? '—' : `${d.toFixed(0)} px${ppm ? ` (${(d / ppm).toFixed(2)} m)` : ''}`,
          r.otherShapeId ? r.otherShapeId.slice(0, 8) : '—',
          r.reason ?? '—',
        ]
      }),
    )
  }

  if (!fill) return
  const g = rasterise(pdfPath, Number(sheet.page_index), join(tmp, sheetId))
  const sizeOk = Math.abs(g.width - page.width) <= 1 && Math.abs(g.height - page.height) <= 1
  console.log(`\nRaster ${g.width}×${g.height} px vs viewport ${page.width}×${page.height} px: ${sizeOk ? 'agree (±1 px)' : 'DISAGREE'}`)
  if (!sizeOk) throw new Error('The raster does not match the pdf.js viewport at scale 2; label coordinates cannot be trusted on it.')
  const mask = maskFromGrey(g)

  const draws = review.rows.filter((r) => r.state === 'draw')
  const out = draws.map((r) => {
    const outcome = fillFromAnchor(mask, r.label.anchor)
    const gla = r.nodeId ? nodeById.get(r.nodeId)?.scheduledM2 ?? null : null
    const gate = gateSuggestion(outcome, ppm, gla)
    const fillM2 = gate.fillM2
    return { r, outcome, gla, gate, fillM2, ratio: fillM2 != null && gla ? fillM2 / gla : null }
  })
  const offered = out.filter((o) => o.gate.offered).length
  console.log(`\nFill (GATE_BAND ${GATE_BAND.min}–${GATE_BAND.max}, GROW_PX ${GROW_PX}): offered ${offered} of ${draws.length} draw rows\n`)
  table(
    ['SHOP', 'tenant', 'outcome', 'fill m²', 'GLA m²', 'fill/GLA', 'offered', 'reason'],
    out.map((o) => [
      o.r.label.tag,
      tagOfNode(o.r.nodeId),
      o.outcome.kind,
      f1(o.fillM2),
      f1(o.gla),
      o.ratio == null ? '—' : o.ratio.toFixed(3),
      o.gate.offered ? 'yes' : 'no',
      o.gate.offered ? '' : o.gate.reason,
    ]),
  )
  const kinds = out.reduce<Record<string, number>>((acc, o) => ((acc[o.outcome.kind] = (acc[o.outcome.kind] ?? 0) + 1), acc), {})
  console.log(`\nOutcomes: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
}

async function main() {
  const { sheets, fill, tmp } = parseArgs(process.argv.slice(2))
  if (!KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY (the "Service role" line of esite/.secrets/supabase.md).')
  const dir = tmp ?? mkdtempSync(join(tmpdir(), 'shop-labels-acceptance-'))
  mkdirSync(dir, { recursive: true })
  console.log(`Read-only run · ${sheets.length} sheet(s) · fill ${fill ? 'on' : 'off'} · temp files in ${dir}`)
  for (const id of sheets) await runSheet(id, fill, dir)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
