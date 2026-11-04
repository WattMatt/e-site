// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildContentSecurityPolicy } from './csp'

// The sign-in pages loaded their typefaces with a runtime
// `@import url('https://fonts.googleapis.com/…')` inside an inline <style>.
// The CSP allows stylesheets and fonts from 'self' only, so the browser refused
// the import and every auth page fell back to system fonts. Fonts are
// self-hosted with next/font instead; this guard fails on any source file that
// pulls a stylesheet or font from an origin the CSP does not allow.

const SRC = join(__dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue
      out.push(...sourceFiles(p))
    } else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

function directive(policy: string, name: string): string[] {
  const found = policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '))
  return found ? found.split(/\s+/).slice(1) : []
}

/** True when `origin` is matched by one of the CSP source expressions. */
function allowedBy(sources: string[], origin: string): boolean {
  return sources.some((s) => {
    if (s === origin) return true
    const wild = /^https:\/\/\*\.(.+)$/.exec(s)
    return wild ? origin.startsWith('https://') && origin.endsWith('.' + wild[1]) : false
  })
}

// Remote stylesheet references: CSS @import url(...) / @import "...",
// and <link ... href="https://..."> (rel=stylesheet or preload as=font).
const IMPORT_RE = /@import\s+(?:url\(\s*)?['"]?(https?:\/\/[^'")\s]+)/g
const LINK_RE = /<link\b[^>]*\bhref=["'{`]*(https?:\/\/[^"'`}\s]+)/g
const FONT_HOST_RE = /https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)/

describe('external stylesheets and fonts are allowed by the CSP', () => {
  const policy = buildContentSecurityPolicy({ dev: false })
  const styleSrc = directive(policy, 'style-src')
  const files = sourceFiles(SRC)

  it('scans a non-trivial source tree', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('every remote @import / <link> origin is in style-src', () => {
    const refused: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const re of [IMPORT_RE, LINK_RE]) {
        for (const m of text.matchAll(re)) {
          const origin = new URL(m[1]).origin
          if (!allowedBy(styleSrc, origin)) refused.push(`${relative(SRC, file)} → ${origin}`)
        }
      }
    }
    expect(refused).toEqual([])
  })

  it('no source references Google Fonts hosts (fonts are self-hosted via next/font)', () => {
    const hits = files
      .filter((f) => FONT_HOST_RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
    expect(hits).toEqual([])
  })
})
