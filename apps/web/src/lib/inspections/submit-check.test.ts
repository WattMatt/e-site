import { describe, it, expect } from 'vitest'
import { submitBlocker } from './submit-check'

const template = {
  template_id: 't', name: 'T', version: '1', deliverable_type: 'coc',
  sections: [
    { section_id: 'wiring', title: 'Wiring images', fields: [
      { field_id: 'a', label: 'A', type: 'photo', required: true, min_count: 1 },
      { field_id: 'b', label: 'B', type: 'photo', required: true, min_count: 1 },
    ] },
    { section_id: 'sign', title: 'Sign-off', fields: [
      { field_id: 'inspector_signature', label: 'Inspector', type: 'signature', required: true },
    ] },
  ],
}

function fakeClient(tables: Record<string, unknown>) {
  const query = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: tables[table] }),
      then: (resolve: (v: { data: unknown }) => void) => resolve({ data: tables[table] }),
    }
    return q
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { schema: () => ({ from: query }) } as any
}

const base = {
  inspections: { template_id: 'tpl' },
  templates: { schema_json: template },
  responses: [],
}

describe('submitBlocker', () => {
  it('lets a complete inspection through: photos and a signature answer their fields', async () => {
    const client = fakeClient({
      ...base,
      photos: [{ section_id: 'wiring', field_id: 'a' }, { section_id: 'wiring', field_id: 'b' }],
      signatures: [{ section_id: 'sign', field_id: 'inspector_signature' }],
    })
    expect(await submitBlocker(client, 'i-1')).toBeNull()
  })

  it('names how many are missing and where the first one is', async () => {
    const client = fakeClient({ ...base, photos: [{ section_id: 'wiring', field_id: 'a' }], signatures: [] })
    expect(await submitBlocker(client, 'i-1')).toBe(
      '1 required item is still missing. The first is in "Sign-off". Complete it and submit again.',
    )
  })

  it('a missing photo never blocks submit (it may carry a reason instead)', async () => {
    const client = fakeClient({ ...base, photos: [], signatures: [{ section_id: 'sign', field_id: 'inspector_signature' }] })
    expect(await submitBlocker(client, 'i-1')).toBeNull()
  })

  it('refuses when the inspection cannot be read', async () => {
    expect(await submitBlocker(fakeClient({ inspections: null }), 'i-1')).toBe('Inspection not found.')
  })
})
