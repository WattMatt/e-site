// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Contract test: no live code may name `app.e-site.live`, and no email template
 * may hardcode a hostname as the visible text of a link.
 *
 * Both rules exist because of one production incident. `app.e-site.live` has
 * NO DNS record. Every app-sent invite redirected there (PR #138): the first
 * click burnt the single-use token on a dead page, the retry showed
 * `otp_expired`, and all 14 invitees were stranded. The canonical host is
 * `www.e-site.live`.
 *
 * After that fix, four templates still set `href` to the correct `siteUrl` but
 * printed `app.e-site.live` as the anchor TEXT — the email told the reader they
 * were going to a host that does not resolve. A hostname in link text is a
 * second copy of the URL that nothing keeps in sync; the only safe label is one
 * derived from the href. So this test:
 *
 *   1. scans every `<a>` in the email templates and fails if the literal text
 *      (interpolations removed) contains anything shaped like a hostname;
 *   2. scans live code for the dead host, comments stripped;
 *   3. asserts every `NEXT_PUBLIC_SITE_URL ?? '…'` fallback in the web app is
 *      the canonical host.
 */

// apps/web/src/lib/email → repo root
const REPO_ROOT = resolve(__dirname, '../../../../..')

export const CANONICAL_SITE_URL = 'https://www.e-site.live'
const DEAD_HOST = 'app.e-site.live'

/** Everything that renders an email body. */
const TEMPLATE_DIRS = [
  'packages/shared/src/email',
  'apps/web/src/lib',
  'apps/edge-functions/supabase/functions',
]

/**
 * Live code. `apps/mobile` is deliberately excluded: `eas.json` and
 * `app.config.ts` still point at the dead host, but universal links are a
 * product decision (point the app at www, or finally give `app.` its CNAME)
 * that this test must not make. Add it here once that decision lands.
 */
const LIVE_CODE_DIRS = [
  'apps/web/src',
  'packages/shared/src',
  'apps/edge-functions/supabase/functions',
]

const CODE_EXT = /\.(ts|tsx)$/
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/
const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|build|\.expo)(\/|$)/

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (SKIP_DIR.test(full)) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (CODE_EXT.test(full) && !TEST_FILE.test(full)) out.push(full)
  }
}

function sourceFiles(dirs: string[]): string[] {
  const out: string[] = []
  for (const d of dirs) walk(join(REPO_ROOT, d), out)
  return out.sort()
}

/**
 * Strip comments so prose about the incident does not read as the incident.
 * Block comments are blanked line-for-line (line numbers survive); line
 * comments are dropped only when the whole line is a comment, so a `//`
 * inside a URL string is never mistaken for one.
 */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  return noBlocks
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
}

/** Remove `${…}` interpolations, honouring nested braces. */
function stripInterpolations(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < s.length && depth > 0) {
        if (s[i] === '{') depth++
        else if (s[i] === '}') depth--
        i++
      }
      continue
    }
    out += s[i++]
  }
  return out
}

/** `www.e-site.live`, `e-site.live`, `dropbox.com` — a dotted label ending in an alphabetic TLD. */
const HOSTNAME_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i
const ANCHOR_RE = /<a\b[^>]*>([\s\S]*?)<\/a>/gi

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length
}

describe('email link text is derived from the URL, never hardcoded', () => {
  it('no <a> in any email template has a literal hostname as its visible text', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(TEMPLATE_DIRS)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(ANCHOR_RE)) {
        const literal = stripInterpolations(m[1]).replace(/<[^>]*>/g, ' ')
        const host = literal.match(HOSTNAME_RE)
        if (host) {
          offenders.push(
            `${relative(REPO_ROOT, file)}:${lineOf(src, m.index!)} → "${host[0]}"`,
          )
        }
      }
    }
    expect(
      offenders,
      `Link text must be derived from the href (e.g. \`\${siteUrl.replace(/^https?:\\/\\//, '')}\`), not typed out:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

describe('the dead host app.e-site.live is gone from live code', () => {
  it('no non-test source names it (comments excluded)', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(LIVE_CODE_DIRS)) {
      const src = stripComments(readFileSync(file, 'utf8'))
      let idx = src.indexOf(DEAD_HOST)
      while (idx !== -1) {
        offenders.push(`${relative(REPO_ROOT, file)}:${lineOf(src, idx)}`)
        idx = src.indexOf(DEAD_HOST, idx + DEAD_HOST.length)
      }
    }
    expect(
      offenders,
      `${DEAD_HOST} has no DNS record; use ${CANONICAL_SITE_URL}:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('every NEXT_PUBLIC_SITE_URL fallback in the web app is the canonical host', () => {
    const FALLBACK_RE = /NEXT_PUBLIC_SITE_URL\s*\?\?\s*(['"`])([^'"`]+)\1/g
    const seen: string[] = []
    const wrong: string[] = []
    for (const file of sourceFiles(['apps/web/src'])) {
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const m of src.matchAll(FALLBACK_RE)) {
        const where = `${relative(REPO_ROOT, file)}:${lineOf(src, m.index!)}`
        seen.push(where)
        if (m[2] !== CANONICAL_SITE_URL) wrong.push(`${where} → '${m[2]}'`)
      }
    }
    // Guard against the regex silently matching nothing (a vacuous pass).
    expect(seen.length, 'expected to find at least one NEXT_PUBLIC_SITE_URL fallback').toBeGreaterThan(0)
    expect(wrong, `Fallbacks must be '${CANONICAL_SITE_URL}':\n  ${wrong.join('\n  ')}`).toEqual([])
  })
})
