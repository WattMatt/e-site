// @vitest-environment node
/**
 * Review M5: every string the proposal PDF draws goes through pdfText (spec §0.4 rule 7) — including
 * fixed headings and the bullet prefix. A literal that happens to be WinAnsi-safe today is one edit
 * away from a silent wrong glyph (react-pdf never throws), so the rule is structural, not per-string.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'proposal-document.tsx'), 'utf8')

describe('proposal-document.tsx: every <Text> child is pdfText(...)', () => {
  it('has no bare JSX text inside a <Text> element', () => {
    const bare = [...src.matchAll(/<Text\b[^>]*>([^<{][^<]*)<\/Text>/g)].map((m) => m[1]!.trim()).filter(Boolean)
    expect(bare).toEqual([])
  })
  it('has no template or string literal child that is not wholly a pdfText call', () => {
    const children = [...src.matchAll(/<Text\b[^>]*>\{([\s\S]*?)\}<\/Text>/g)].map((m) => m[1]!.trim())
    expect(children.length).toBeGreaterThan(5)
    const outside = children.filter((c) => !/^pdfText\(/.test(c))
    expect(outside).toEqual([])
  })
})
