/**
 * Test helper: the text of a react-pdf PDF, read from its content streams and decoded as WinAnsi
 * (NOT latin1 — latin1 mangles 0x80–0x9F and made assertions on real punctuation pass vacuously,
 * the PR #161 finding). Only for tests; tests using it need `// @vitest-environment node`.
 */
import zlib from 'node:zlib'

const WINANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
}

function fromWinAnsi(bytes: Buffer): string {
  let out = ''
  for (const b of bytes) out += WINANSI_HIGH[b] ?? String.fromCharCode(b)
  return out
}

export function extractPdfText(buf: Buffer): string {
  let text = ''
  const streamMarker = Buffer.from('stream')
  const endMarker = Buffer.from('endstream')
  let cursor = 0
  for (;;) {
    const start = buf.indexOf(streamMarker, cursor)
    if (start === -1) break
    const end = buf.indexOf(endMarker, start)
    if (end === -1) break
    let dataStart = start + streamMarker.length
    while (buf[dataStart] === 0x0d || buf[dataStart] === 0x0a) dataStart++
    const chunk = buf.subarray(dataStart, end)
    let decoded: string
    try {
      decoded = zlib.inflateSync(chunk).toString('latin1')
    } catch {
      decoded = chunk.toString('latin1')
    }
    for (const m of decoded.matchAll(/<([0-9a-fA-F]+)>/g)) text += fromWinAnsi(Buffer.from(m[1]!, 'hex'))
    cursor = end + endMarker.length
  }
  return text
}

/** Whitespace-free comparison form: a wrapped line drops its break space, so compare without spaces. */
export const squash = (s: string) => s.replace(/\s+/g, '')
