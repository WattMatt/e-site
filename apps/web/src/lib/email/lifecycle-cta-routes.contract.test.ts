// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every lifecycle-email CTA must point at a route that exists.
 *
 * Why this test and not a code review: four CTAs shipped pointing at routes
 * deleted in May and nobody noticed for four months. `(admin)/compliance/**`
 * went in commit debd883 (2026-05-18); `settings/team` was renamed to
 * `settings/users` in 1237649 (2026-05-20); `/feedback/call` never existed at
 * all. 120 emails went to 30 real recipients over dead links, and because zero
 * opens and zero clicks have ever been recorded on any of the 246 lifecycle
 * sends, nothing in the product could have surfaced it. The failure is
 * structurally invisible: deleting a route does not break a string in an
 * unrelated Deno file, and middleware 307s an unmatched path to /login before
 * Next can 404 it, so even hitting the URL looks like a login prompt rather
 * than a missing page.
 *
 * The fixture question — what would this have to look like to be able to fail?
 * It has to resolve the href against the REAL App Router tree on disk, not
 * against a hand-written list of known-good paths (a list drifts exactly the
 * way the templates drifted). And the resolver itself has to be able to say
 * "no" — hence `resolver rejects a path that does not exist`, below, without
 * which every assertion here would pass vacuously.
 *
 * Scope is the edge lifecycle templates. packages/shared/src/email/*.ts builds
 * its links by string interpolation rather than a `ctaHref:` field and is owned
 * elsewhere; extending the resolver to it is a separate change.
 *
 * apps/web/src/lib/email -> five levels up is the repo root.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const TEMPLATE_DIR = resolve(
  ROOT,
  'apps/edge-functions/supabase/functions/_shared/email-templates',
)
const APP_DIR = resolve(ROOT, 'apps/web/src/app')

// ─── Build the route table from the App Router tree ──────────────────────────

/**
 * Collect every URL path the app actually serves: a directory holding a
 * `page.tsx`/`page.ts` (a page) or a `route.ts` (a handler). Route groups
 * `(admin)` contribute no URL segment; `[id]` matches one segment; `[...rest]`
 * matches one or more.
 */
function collectRoutePatterns(dir: string, urlSegments: string[] = []): string[] {
  const out: string[] = []
  const entries = readdirSync(dir)

  const servesAPath = entries.some(e =>
    e === 'page.tsx' || e === 'page.ts' || e === 'route.ts' || e === 'route.tsx',
  )
  if (servesAPath) out.push('/' + urlSegments.join('/'))

  for (const entry of entries) {
    const full = resolve(dir, entry)
    if (!statSync(full).isDirectory()) continue
    if (entry.startsWith('_') || entry === 'node_modules') continue
    // (group) and @slot segments contribute nothing to the URL.
    const contributes = !(entry.startsWith('(') || entry.startsWith('@'))
    out.push(...collectRoutePatterns(full, contributes ? [...urlSegments, entry] : urlSegments))
  }
  return out
}

const ROUTE_PATTERNS = collectRoutePatterns(APP_DIR)

function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('/')
    .filter(Boolean)
    .map(seg => {
      if (/^\[\.\.\..+\]$/.test(seg)) return '.+'        // catch-all
      if (/^\[.+\]$/.test(seg))       return '[^/]+'     // dynamic
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return new RegExp(`^/${body}/?$`)
}

const ROUTE_REGEXPS = ROUTE_PATTERNS.map(patternToRegExp)

function routeExists(pathname: string): boolean {
  const clean = pathname.split('#')[0].split('?')[0]
  return ROUTE_REGEXPS.some(re => re.test(clean))
}

// ─── Pull every ctaHref out of the templates ─────────────────────────────────

interface Cta { file: string; href: string }

function ctaHrefs(): Cta[] {
  const out: Cta[] = []
  for (const file of readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.ts'))) {
    const src = readFileSync(resolve(TEMPLATE_DIR, file), 'utf8')
    for (const m of src.matchAll(/ctaHref:\s*`([^`]*)`/g)) {
      out.push({ file, href: m[1] })
    }
  }
  return out
}

const CTAS = ctaHrefs()

describe('lifecycle email CTA targets resolve to real routes', () => {
  it('the resolver found the App Router tree at all', () => {
    // Guards against a silent pass caused by a wrong ROOT: an empty route table
    // would make routeExists() return false for everything, which fails loudly,
    // but a *partial* table would not. Two routes that must always exist.
    expect(ROUTE_PATTERNS.length).toBeGreaterThan(50)
    expect(ROUTE_PATTERNS).toContain('/dashboard')
    expect(ROUTE_PATTERNS).toContain('/settings/users')
  })

  it('the resolver rejects a path that does not exist', () => {
    // Without this, every assertion below could be passing vacuously.
    expect(routeExists('/compliance')).toBe(false)
    expect(routeExists('/settings/team')).toBe(false)
    expect(routeExists('/feedback/call')).toBe(false)
    // …and still accepts the real ones, including dynamic segments.
    expect(routeExists('/settings/users')).toBe(true)
    expect(routeExists('/projects/new')).toBe(true)
    expect(routeExists('/projects/8f0d/diary')).toBe(true)
  })

  it('found a CTA in every template that has one', () => {
    // If the regex stopped matching (say the field were renamed), CTAS would be
    // empty and the real assertion below would iterate nothing.
    expect(CTAS.length).toBeGreaterThanOrEqual(10)
  })

  it.each(CTAS.map(c => [c.file, c.href] as const))(
    '%s → %s',
    (file, href) => {
      if (href.startsWith('mailto:')) {
        expect(href, `${file}: mailto must carry an address`).toMatch(/^mailto:[^@\s]+@[^@\s]+/)
        return
      }
      expect(href, `${file}: CTA must be site-relative`).toContain('${vars.siteUrl}')
      const pathname = href.replace('${vars.siteUrl}', '')
      expect(routeExists(pathname), `${file}: no route serves ${pathname}`).toBe(true)
    },
  )
})
