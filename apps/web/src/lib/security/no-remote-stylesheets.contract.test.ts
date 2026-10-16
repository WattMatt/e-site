import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { buildContentSecurityPolicy } from './csp'

/**
 * The CSP's style-src and font-src admit only 'self' (plus inline / data:), so a
 * stylesheet or font fetched from another host is blocked in production and the
 * page silently falls back to system fonts. The auth layout did exactly this
 * with a Google Fonts @import (2026-10-06, /login). Fonts are self-hosted at
 * build time through next/font instead; this guard fails on any remote
 * stylesheet reference in the web app's source.
 */

const SRC = path.resolve(__dirname, '../..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

// A remote @import, a <link rel="stylesheet"> to another host, or a direct
// reference to either Google Fonts host.
const REMOTE_STYLE = [
  /@import\s+(url\()?\s*['"]?https?:\/\//i,
  /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\//i,
  /fonts\.(googleapis|gstatic)\.com/i,
]

describe('no stylesheet or font is loaded from another host', () => {
  it('the CSP still admits only self-hosted styles and fonts', () => {
    const policy = buildContentSecurityPolicy({ dev: false })
    expect(policy).toContain("style-src 'self' 'unsafe-inline';")
    expect(policy).toContain("font-src 'self' data:;")
  })

  it('no web source file references a remote stylesheet', () => {
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(100)
    const offenders: string[] = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (REMOTE_STYLE.some((re) => re.test(line))) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('the auth layout self-hosts its faces through next/font', () => {
    const layout = readFileSync(path.join(SRC, 'app/(auth)/layout.tsx'), 'utf8')
    expect(layout).toMatch(/import\s*\{[^}]*\bInstrument_Sans\b[^}]*\}\s*from\s*'next\/font\/google'/)
    expect(layout).toMatch(/import\s*\{[^}]*\bDM_Mono\b[^}]*\}\s*from\s*'next\/font\/google'/)
  })
})
