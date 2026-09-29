// apps/web/src/lib/solar/load/ndjson.test.ts
import { describe, it, expect } from 'vitest'
import { parseNdjson } from './ndjson'

describe('parseNdjson', () => {
  it('returns whole lines as events and keeps the partial tail', () => {
    const a = parseNdjson('', '{"type":"progress","stage":"reading","done":1,"total":2}\n{"type":"do')
    expect(a.events).toEqual([{ type: 'progress', stage: 'reading', done: 1, total: 2 }])
    const b = parseNdjson(a.rest, 'ne","siteLoadId":"x","basis":"S2","referenceYear":2025,"checks":0}\n\n')
    expect(b.events).toEqual([{ type: 'done', siteLoadId: 'x', basis: 'S2', referenceYear: 2025, checks: 0 }])
    expect(b.rest).toBe('')
  })
})
