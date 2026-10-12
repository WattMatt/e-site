/**
 * Test helper: read what a pdf-lib PDF actually DRAWS. Coordinates are asserted on the decoded
 * content streams, never on "a PDF rendered" (spec §10). Node only — use `// @vitest-environment node`.
 */
import zlib from 'node:zlib'
import { extractPdfText } from './pdf-text'

/** Every stream body, Flate-inflated when it inflates, else raw — latin1 text. */
export function pdfStreams(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes)
  const out: string[] = []
  const open = Buffer.from('stream')
  const close = Buffer.from('endstream')
  let cursor = 0
  for (;;) {
    const s = buf.indexOf(open, cursor)
    if (s === -1) break
    const e = buf.indexOf(close, s + open.length)
    if (e === -1) break
    let start = s + open.length
    while (buf[start] === 0x0d || buf[start] === 0x0a) start++
    const chunk = buf.subarray(start, e)
    try { out.push(zlib.inflateSync(chunk).toString('latin1')) } catch { out.push(chunk.toString('latin1')) }
    cursor = e + close.length
  }
  return out
}

/** Raw file text plus every decoded stream (object-stream dictionaries are only visible decoded). */
export function pdfAllText(bytes: Uint8Array): string {
  return `${Buffer.from(bytes).toString('latin1')}\n${pdfStreams(bytes).join('\n')}`
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`

export interface PaintedPath { points: Array<[number, number]>; moves: number; closed: boolean; paint: 'S' | 'f' | 'B' }

/** Paths built with m/l/h and painted with S, f or B, in drawing order. */
export function paintedPaths(stream: string): PaintedPath[] {
  const re = new RegExp(String.raw`(${NUM})\s+(${NUM})\s+([ml])(?![\w])|(?<![\w/.-])(h|S|f|B)(?![\w*])`, 'g')
  const out: PaintedPath[] = []
  let points: Array<[number, number]> = []
  let moves = 0
  let closed = false
  for (const m of stream.matchAll(re)) {
    if (m[3]) {
      if (m[3] === 'm') moves++
      points.push([Number(m[1]), Number(m[2])])
      continue
    }
    if (m[4] === 'h') { closed = true; continue }
    if (points.length) out.push({ points, moves, closed, paint: m[4] as PaintedPath['paint'] })
    points = []
    moves = 0
    closed = false
  }
  return out
}

/** The 6 numbers of the `cm` immediately before `/<prefix…> Do`. */
export function cmBeforeDo(stream: string, namePrefix: string): number[][] {
  const re = new RegExp(String.raw`((?:${NUM}\s+){6})cm\s+\/(${namePrefix}[^\s/]*)\s+Do`, 'g')
  return [...stream.matchAll(re)].map((m) => m[1]!.trim().split(/\s+/).map(Number))
}

export function near(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol
}

export function samePoints(got: Array<[number, number]>, want: Array<[number, number]>, tol = 0.02): boolean {
  return got.length === want.length && want.every(([x, y]) => got.some(([gx, gy]) => near(gx, x, tol) && near(gy, y, tol)))
}

/**
 * The text a PDF DRAWS: hex string operands of content streams that show text (Tj/TJ), WinAnsi-decoded
 * by extractPdfText. Unlike extractPdfText on the whole file, it skips the UTF-16 Info dictionary
 * (title, producer) that pdf-lib writes as hex strings into an object stream.
 */
export function drawnText(bytes: Uint8Array): string {
  return pdfStreams(bytes)
    .filter((s) => /\bT[jJ]\b/.test(s))
    .map((s) => extractPdfText(Buffer.from(`stream\n${s}\nendstream`, 'latin1')))
    .join('')
}
