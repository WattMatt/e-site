// apps/web/src/lib/whatsapp/item-page-data.test.ts
import { describe, it, expect } from 'vitest'
import { noteText, logRows } from './item-page-data'

describe('item page view model', () => {
  it('a redacted note prints as withdrawn, never its old body', () => {
    expect(noteText({ body: '', redacted_at: '2026-10-01T10:00:00Z' })).toBe('[message withdrawn]')
    expect(noteText({ body: 'Cover refitted', redacted_at: null })).toBe('Cover refitted')
  })
  it('merges outbound and inbound into one time-ordered log', () => {
    const rows = logRows(
      [{ id: 'o', trigger: 'assigned', status: 'read', error_text: null, created_at: '2026-10-01T08:00:00Z', sent_at: '2026-10-01T08:00:05Z' }],
      [{ id: 'i', kind: 'image', outcome: 'applied', outcome_reason: 'attachment', received_at: '2026-10-01T09:00:00Z' }],
    )
    expect(rows.map((r) => r.id)).toEqual(['o', 'i'])
    expect(rows[0]).toMatchObject({ direction: 'out', label: 'assigned', status: 'read' })
    expect(rows[1]).toMatchObject({ direction: 'in', label: 'image', status: 'applied', detail: 'attachment' })
  })
})
