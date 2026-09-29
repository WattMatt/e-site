// apps/web/src/lib/solar/schematics/svg.ts
/**
 * SVG download of a schematic (functional spec §13.2 "Export"): drawing + cards + lines, with the
 * background EMBEDDED as a data URL (not a public URL — the drawings bucket is private). Built as an
 * escaped string and saved as a Blob; nothing is ever assigned to innerHTML.
 */
export interface SvgCard { meterId: string; x: number; y: number; w: number; h: number; colour: string | null; label: string; sublabel: string; included: boolean | null }
export interface SvgLine { points: number[]; lineType: 'supply' | 'check' }
export interface SvgInput {
  width: number
  height: number
  backgroundDataUrl: string | null
  cards: SvgCard[]
  lines: SvgLine[]
  layers: { background: boolean; meters: boolean; lines: boolean }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const n = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0)
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/

export function buildSchematicSvg(i: SvgInput): string {
  if (i.backgroundDataUrl !== null && !i.backgroundDataUrl.startsWith('data:image/')) throw new Error('The background must be a data URL.')
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(i.width)}" height="${n(i.height)}" viewBox="0 0 ${n(i.width)} ${n(i.height)}">`]
  parts.push(`<rect width="${n(i.width)}" height="${n(i.height)}" fill="#ffffff"/>`)
  if (i.layers.background && i.backgroundDataUrl) parts.push(`<image href="${esc(i.backgroundDataUrl)}" x="0" y="0" width="${n(i.width)}" height="${n(i.height)}"/>`)
  if (i.layers.lines) {
    for (const l of i.lines) {
      const pts = []
      for (let k = 0; k + 1 < l.points.length; k += 2) pts.push(`${n(l.points[k])},${n(l.points[k + 1])}`)
      parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${l.lineType === 'check' ? '#64748b' : '#d97706'}" stroke-width="3"${l.lineType === 'check' ? ' stroke-dasharray="8 6"' : ''}/>`)
    }
  }
  if (i.layers.meters) {
    for (const c of i.cards) {
      const colour = c.colour && COLOUR_RE.test(c.colour) ? c.colour : '#2563eb'
      parts.push(`<g><rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}" rx="6" fill="#ffffff" stroke="${colour}" stroke-width="2"${c.included === false ? ' stroke-dasharray="6 4"' : ''}/>`)
      parts.push(`<rect x="${n(c.x)}" y="${n(c.y)}" width="8" height="${n(c.h)}" fill="${colour}"/>`)
      parts.push(`<text x="${n(c.x + 14)}" y="${n(c.y + 24)}" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#0f172a">${esc(c.label)}</text>`)
      parts.push(`<text x="${n(c.x + 14)}" y="${n(c.y + 46)}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#475569">${esc(c.sublabel)}${c.included === false ? ' · excluded from load' : ''}</text></g>`)
    }
  }
  parts.push('</svg>')
  return parts.join('')
}
