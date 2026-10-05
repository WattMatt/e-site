/**
 * Contract for the phone patterns (E2 slice C). Derived from the source, not
 * from a list typed here: every table that opts into `table-cards` is found by
 * scanning the app, and every cell in it must say what it is on a phone card —
 * an unlabelled cell would show a bare value with no column name.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { PHONE_QUERY } from '@/lib/mobile/use-phone-viewport'

const SRC = path.join(__dirname, '../..')
const css = readFileSync(path.join(SRC, 'app/globals.css'), 'utf8')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p)
    return /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : []
  })
}

/** Every phone media block's text, concatenated. */
const phoneCss = (() => {
  let out = ''
  let from = 0
  for (;;) {
    const start = css.indexOf(`@media ${PHONE_QUERY} {`, from)
    if (start === -1) return out
    let depth = 0
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) { out += css.slice(start, i + 1); from = i + 1; break }
    }
  }
})()

const files = walk(SRC)
const cardTables = files.filter((f) => /className="[^"]*\btable-cards\b/.test(readFileSync(f, 'utf8')))

describe('table-cards', () => {
  it('is used by the field lists the audit flagged', () => {
    const rel = cardTables.map((f) => path.relative(SRC, f))
    for (const must of ['inspections/page.tsx', 'forms/page.tsx', 'cables/RevisionsList.tsx']) {
      expect(rel.some((r) => r.endsWith(must)), must).toBe(true)
    }
  })

  it.each(cardTables.map((f) => [path.relative(SRC, f), f]))('%s labels every body cell', (_rel, file) => {
    const src = readFileSync(file, 'utf8')
    const body = src.slice(src.indexOf('table-cards'))
    const cells = [...body.matchAll(/<(td|Td)\b([^>]*)>/g)]
    expect(cells.length).toBeGreaterThan(0)
    for (const [tag, , attrs] of cells) {
      expect(/\bdata-label=|\bdata-primary\b|\bdata-actions\b|\blabel=|\bprimary\b|\bactions\b/.test(attrs), tag).toBe(true)
    }
    expect(body).toMatch(/data-primary|\bprimary\b/)
  })

  it('has its phone rules: header hidden, rows as blocks, labels from data-label', () => {
    expect(phoneCss).toMatch(/table\.table-cards thead\s*\{\s*display:\s*none;/)
    expect(phoneCss).toMatch(/table\.table-cards td\[data-label\]::before\s*\{[^}]*content:\s*attr\(data-label\)/)
  })
})

describe('other phone patterns', () => {
  it('every class the pages opt into is defined for phones', () => {
    for (const cls of ['stack-on-phone', 'sticky-actions']) {
      const used = files.some((f) => new RegExp(`className="[^"]*\\b${cls}\\b`).test(readFileSync(f, 'utf8')))
      expect(used, `${cls} used`).toBe(true)
      expect(phoneCss, `${cls} defined`).toContain(`.${cls}`)
    }
    expect(phoneCss).toMatch(/\.stack-on-phone\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important;/)
  })

  it('keeps form fields at 16 px on phones so iOS does not zoom on focus', () => {
    expect(phoneCss).toMatch(/textarea\s*\{\s*font-size:\s*16px !important;/)
  })

  it('panels scroll sideways on phones instead of clipping what does not fit', () => {
    expect(phoneCss).toMatch(/\.data-panel\s*\{\s*overflow-x:\s*auto;/)
  })

  it('touch-hit enlarges the hit area on touch screens, and is only used on positioned controls', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.touch-hit::after\s*\{[^}]*inset:\s*-12px/)
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/className="touch-hit"/g)) {
        // The element's own props (handlers contain '=>', so no tag-end search).
        expect(src.slice(m.index, m.index! + 1500), path.relative(SRC, f)).toMatch(/position:\s*'absolute'/)
      }
    }
  })

  it('opens the rear camera directly on the three snag evidence inputs', () => {
    for (const rel of [
      'app/(admin)/projects/[id]/snags/new/page.tsx',
      'app/(admin)/snags/[id]/SnagPhotoUploader.tsx',
      'app/(admin)/projects/[id]/snags/visits/[visitId]/VisitDetail.tsx',
    ]) {
      const src = readFileSync(path.join(SRC, rel), 'utf8')
      const input = src.slice(src.indexOf('type="file"'), src.indexOf('type="file"') + 300)
      expect(input, rel).toContain('capture="environment"')
    }
  })
})
