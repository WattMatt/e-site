import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Contract (00219): solar.audit_events is SERVICE-written. Authenticated users hold no INSERT
 * grant or policy on it, so an editor cannot post a forged "Recent activity" line. The only
 * writer in the app is lib/solar/audit.ts (recordSolarAudit, service client, called AFTER each
 * action's own Solar gate). A second writer with the user's client would fail at runtime (42501)
 * and silently lose the line — recordSolarAudit logs and swallows, the old repo path threw.
 *
 * DERIVED by scanning every non-test source file for an audit_events write, rather than a
 * hand-kept list that a new writer would simply not be on.
 */
const SRC = resolve(__dirname, '../..')
const EDGE = resolve(__dirname, '../../../../edge-functions/supabase/functions')
const ALLOWED = new Set(['lib/solar/audit.ts'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('solar.audit_events writers', () => {
  it('only lib/solar/audit.ts writes audit_events (insert/upsert/update/delete)', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const text = readFileSync(f, 'utf8')
      const re = /from\(\s*['"]audit_events['"]\s*\)\s*\.\s*(insert|upsert|update|delete)\b/g
      if (re.test(text) && !ALLOWED.has(relative(SRC, f).split('\\').join('/'))) offenders.push(relative(SRC, f))
    }
    expect(offenders).toEqual([])
  })
  it('no edge function writes audit_events either', () => {
    const offenders = walk(EDGE).filter((f) => /from\(\s*['"]audit_events['"]\s*\)\s*\.\s*(insert|upsert|update|delete)\b/.test(readFileSync(f, 'utf8')))
    expect(walk(EDGE).length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
  it('the allowed writer uses the service client', () => {
    const text = readFileSync(join(SRC, 'lib/solar/audit.ts'), 'utf8')
    expect(text).toMatch(/createServiceClient\(\)/)
    expect(text).toMatch(/from\('audit_events'\)\.insert/)
  })
})
