// @vitest-environment node
import { describe, expect, it } from 'vitest'

import nextConfig from '../../next.config'

// A custom cacheGroup that matches by node_modules PATH also claims CSS that
// lives there (next/font's generated CSS, maplibre-gl.css). When the group is
// `vendors` (chunks: 'all'), that CSS lands in the root main-app chunk group,
// Next lists it in rootMainFiles and renders it as <script src=".css"> on every
// page — "Refused to execute script … MIME type ('text/css')". Each group must
// accept JavaScript modules only.

type CacheGroup = { name?: string; type?: unknown }

function clientCacheGroups(): Record<string, CacheGroup> {
  const out = nextConfig.webpack!({ optimization: {} } as any, { isServer: false } as any) as any
  return out.optimization.splitChunks.cacheGroups
}

// Mirrors webpack's cacheGroup `type` check (string equality, RegExp test, or
// predicate); an absent `type` matches every module.
function acceptsModuleType(group: CacheGroup, moduleType: string): boolean {
  const t = group.type
  if (t === undefined) return true
  if (typeof t === 'string') return t === moduleType
  if (t instanceof RegExp) return t.test(moduleType)
  if (typeof t === 'function') return Boolean((t as (s: string) => unknown)(moduleType))
  throw new Error(`unexpected cacheGroup type: ${String(t)}`)
}

describe('next.config client splitChunks', () => {
  const groups = Object.entries(clientCacheGroups())

  it('defines the custom groups', () => {
    expect(groups.map(([key]) => key).sort()).toEqual(
      ['observability', 'reactQuery', 'supabase', 'three', 'vendors'],
    )
  })

  // css/mini-extract is the type of an extracted CSS module in a production
  // build; css covers webpack's native CSS experiment.
  it.each(groups)('group %s never claims a CSS module', (_key, group) => {
    expect(acceptsModuleType(group, 'css/mini-extract')).toBe(false)
    expect(acceptsModuleType(group, 'css')).toBe(false)
  })

  it.each(groups)('group %s still claims JavaScript modules', (_key, group) => {
    for (const t of ['javascript/auto', 'javascript/esm', 'javascript/dynamic']) {
      expect(acceptsModuleType(group, t)).toBe(true)
    }
  })

  it('leaves the server bundle alone', () => {
    const input = { optimization: { splitChunks: { marker: true } } }
    const out = nextConfig.webpack!(input as any, { isServer: true } as any) as any
    expect(out.optimization.splitChunks).toEqual({ marker: true })
  })
})
