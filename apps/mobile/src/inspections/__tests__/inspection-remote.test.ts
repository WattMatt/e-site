import { describe, expect, it } from 'vitest'
import { createInspectionRemote, SUBMITTABLE_STATUSES } from '../inspection-remote'

// A recording stand-in for the supabase-js query builder: every chained call is
// logged, and awaiting the chain yields the next scripted result.
type Result = { data?: unknown; error?: { message: string; code?: string } | null; status?: number }

function fakeClient(results: Result[]) {
  const log: Array<{ schema: string; table: string; calls: Array<[string, unknown[]]> }> = []
  const client = {
    schema(schema: string) {
      return {
        from(table: string) {
          const entry = { schema, table, calls: [] as Array<[string, unknown[]]> }
          log.push(entry)
          const builder: Record<string, unknown> = {}
          for (const m of ['select', 'insert', 'update', 'upsert', 'eq', 'in', 'neq', 'not', 'order', 'limit', 'maybeSingle', 'single']) {
            builder[m] = (...args: unknown[]) => {
              entry.calls.push([m, args])
              return builder
            }
          }
          builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(results.shift() ?? { data: null, error: null, status: 200 }).then(resolve, reject)
          return builder
        },
      }
    },
  }
  return { client, log }
}

const values = {
  value_bool: null,
  value_number: 12.5,
  value_text: null,
  value_array: null,
  value_json: null,
  pass_state: 'pass',
  fail_reason: null,
}

describe('upsertResponse', () => {
  it('upserts on the natural key with the capturing user as responder (mirrors web upsertResponseAction)', async () => {
    const { client, log } = fakeClient([{ data: null, error: null, status: 201 }])
    const remote = createInspectionRemote(client)

    const err = await remote.upsertResponse({
      inspectionId: 'i1',
      sectionId: 's1',
      fieldId: 'f1',
      values,
      respondedBy: 'u1',
      respondedAt: '2026-10-05T10:00:00.000Z',
    })

    expect(err).toBeNull()
    expect(log[0]).toMatchObject({ schema: 'inspections', table: 'responses' })
    expect(log[0].calls).toEqual([
      [
        'upsert',
        [
          {
            inspection_id: 'i1',
            section_id: 's1',
            field_id: 'f1',
            ...values,
            latest_responded_by: 'u1',
            latest_responded_at: '2026-10-05T10:00:00.000Z',
          },
          { onConflict: 'inspection_id,section_id,field_id' },
        ],
      ],
    ])
  })

  it('reports the HTTP status with the error so the outbox can classify it', async () => {
    const { client } = fakeClient([{ data: null, error: { message: 'rls', code: '42501' }, status: 403 }])
    const err = await createInspectionRemote(client).upsertResponse({
      inspectionId: 'i1', sectionId: 's1', fieldId: 'f1', values, respondedBy: 'u1', respondedAt: 'x',
    })
    expect(err).toEqual({ message: 'rls', code: '42501', status: 403 })
  })
})

describe('reads', () => {
  it('lists in-flight inspections only (same scope as the org_inspections sync bucket), optionally mine', async () => {
    const { client, log } = fakeClient([{ data: [{ id: 'i1' }], error: null, status: 200 }])
    const rows = await createInspectionRemote(client).listInspections({ assignedTo: 'u1' })
    expect(rows).toEqual([{ id: 'i1' }])
    expect(log[0]).toMatchObject({ schema: 'inspections', table: 'inspections' })
    expect(log[0].calls).toContainEqual(['not', ['status', 'in', '(certified,abandoned)']])
    expect(log[0].calls).toContainEqual(['eq', ['assigned_to_id', 'u1']])
  })

  it('throws the server error from a list read rather than showing an empty list', async () => {
    const { client } = fakeClient([{ data: null, error: { message: 'boom' }, status: 500 }])
    await expect(createInspectionRemote(client).listInspections({})).rejects.toThrow('boom')
  })

  it('loads the capture bundle: inspection, its template by template_id, responses and photo slots', async () => {
    const { client, log } = fakeClient([
      { data: { id: 'i1', template_id: 't9', target_label: 'DB-1', status: 'assigned', project_id: 'p1' }, error: null, status: 200 },
      { data: { id: 't9', name: 'LV CoC', schema_json: { sections: [] } }, error: null, status: 200 },
      { data: [{ section_id: 's1', field_id: 'f1', value_text: 'x' }], error: null, status: 200 },
      { data: [{ section_id: 's1', field_id: 'f2' }], error: null, status: 200 },
    ])

    const bundle = await createInspectionRemote(client).loadCaptureBundle('i1')

    expect(bundle).toEqual({
      inspection: { id: 'i1', template_id: 't9', target_label: 'DB-1', status: 'assigned', project_id: 'p1' },
      template: { id: 't9', name: 'LV CoC', schema_json: { sections: [] } },
      responses: [{ section_id: 's1', field_id: 'f1', value_text: 'x' }],
      photos: [{ section_id: 's1', field_id: 'f2' }],
    })
    expect(log.map((l) => l.table)).toEqual(['inspections', 'templates', 'responses', 'photos'])
    expect(log[1].calls).toContainEqual(['eq', ['id', 't9']])
  })

  it('returns null for an inspection the user cannot see', async () => {
    const { client } = fakeClient([{ data: null, error: null, status: 200 }])
    expect(await createInspectionRemote(client).loadCaptureBundle('nope')).toBeNull()
  })
})

describe('submitInspection', () => {
  it('sends ONLY status and completed_at, from a submittable status (the status guard refuses anything wider)', async () => {
    const { client, log } = fakeClient([{ data: [{ id: 'i1' }], error: null, status: 200 }])

    const err = await createInspectionRemote(client).submitInspection({ inspectionId: 'i1', completedAt: '2026-10-05T10:00:00.000Z' })

    expect(err).toBeNull()
    expect(log).toHaveLength(1)
    const calls = log[0].calls
    expect(calls[0]).toEqual(['update', [{ status: 'awaiting_verification', completed_at: '2026-10-05T10:00:00.000Z' }]])
    expect(Object.keys((calls[0][1][0] as object))).toEqual(['status', 'completed_at'])
    expect(calls).toContainEqual(['eq', ['id', 'i1']])
    expect(calls).toContainEqual(['in', ['status', [...SUBMITTABLE_STATUSES]]])
    expect(SUBMITTABLE_STATUSES).toEqual(['in_progress', 're-inspect_required'])
  })

  it('treats "already awaiting verification" as done (a retry after a lost response)', async () => {
    const { client } = fakeClient([
      { data: [], error: null, status: 200 },
      { data: { status: 'awaiting_verification' }, error: null, status: 200 },
    ])
    expect(await createInspectionRemote(client).submitInspection({ inspectionId: 'i1', completedAt: 'x' })).toBeNull()
  })

  it('refuses with a readable sentence when the inspection is in a status that cannot be submitted', async () => {
    const { client } = fakeClient([
      { data: [], error: null, status: 200 },
      { data: { status: 'assigned' }, error: null, status: 200 },
    ])
    const err = await createInspectionRemote(client).submitInspection({ inspectionId: 'i1', completedAt: 'x' })
    expect(err).toEqual({ status: 409, message: expect.stringMatching(/assigned/) })
  })

  it('refuses when the inspection is no longer visible', async () => {
    const { client } = fakeClient([
      { data: [], error: null, status: 200 },
      { data: null, error: null, status: 200 },
    ])
    const err = await createInspectionRemote(client).submitInspection({ inspectionId: 'i1', completedAt: 'x' })
    expect(err?.status).toBe(404)
  })

  it('passes a transport failure through with status 0', async () => {
    const { client } = fakeClient([{ data: null, error: { message: 'FetchError: Network request failed', code: '' }, status: 0 }])
    const err = await createInspectionRemote(client).submitInspection({ inspectionId: 'i1', completedAt: 'x' })
    expect(err).toMatchObject({ status: 0 })
  })
})
