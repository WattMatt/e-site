import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

/**
 * PAGE → CLIENT PROPS MUST BE JSON. A function passed from a page.tsx to a
 * 'use client' component passes tsc AND next build and fails only at render
 * (PR #201). The runtime half of this guard is load-plan-page.test.ts
 * (jsonUnsafePath on the assembled props); this half reads the two tenant plan
 * routes and fails if any client component they render is handed an arrow
 * function, a function expression or a server action by name.
 */
const BASE = resolve(__dirname, '../../app/(admin)/projects/[id]/tenant-schedule')
const PAGES = [resolve(BASE, 'floor-plan/page.tsx'), resolve(BASE, 'line-diagram/page.tsx')]

function clientComponents(src: string, dir: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+'(\.[^']+)'/g)) {
    const base = resolve(dir, m[2]!)
    const file = ['.tsx', '.ts'].map((e) => base + e).find((f) => existsSync(f))
    if (!file || !/^\s*['"]use client['"]/.test(readFileSync(file, 'utf8'))) continue
    out.push(...m[1]!.split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean))
  }
  return out
}

/** Every opening tag of <Name …>, braces respected, so `=>` inside {} does not end it. */
function openingTags(src: string, name: string): string[] {
  const tags: string[] = []
  const re = new RegExp(`<${name}\\b`, 'g')
  for (const m of src.matchAll(re)) {
    let depth = 0
    let j = m.index! + name.length + 1
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push(src.slice(m.index!, j + 1))
  }
  return tags
}

describe('tenant plan routes hand their client components JSON only', () => {
  for (const page of PAGES) {
    it(page.slice(BASE.length), () => {
      const src = readFileSync(page, 'utf8')
      const names = clientComponents(src, dirname(page))
      expect(names.length, 'expected the page to render a client component').toBeGreaterThan(0)
      for (const n of names) {
        const tags = openingTags(src, n)
        expect(tags.length, `${n} is imported but never rendered`).toBeGreaterThan(0)
        for (const tag of tags) expect(tag, `${n} receives a function`).not.toMatch(/=>|\bfunction\b|Action\b/)
      }
    })

    it(`${page.slice(BASE.length)} spreads the assembled props and adds nothing`, () => {
      const src = readFileSync(page, 'utf8')
      expect(openingTags(src, 'StatusPlanWorkspace')).toEqual(['<StatusPlanWorkspace {...data.props} />'])
      expect(openingTags(src, 'TenantPlanEmpty')).toEqual(['<TenantPlanEmpty {...data.empty} />'])
    })
  }
})
