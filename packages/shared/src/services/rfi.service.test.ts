import { describe, it, expect, vi, afterEach } from 'vitest'
import { rfiService, RFI_CLOSE_REFUSED } from './rfi.service'
import { projectSettingsService } from './project-settings.service'

// Captures the row handed to .insert() so we can assert what actually gets
// written to projects.rfis, while echoing it back as the "created" row.
function buildInsertCaptureClient() {
  const captured: { payload?: any } = {}
  const single = vi.fn(() =>
    Promise.resolve({ data: { id: 'rfi-1', ...(captured.payload ?? {}) }, error: null }),
  )
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn((payload: any) => {
    captured.payload = payload
    return { select }
  })
  const from = vi.fn(() => ({ insert }))
  const schema = vi.fn(() => ({ from }))
  return { client: { schema } as any, captured }
}

const ORG = 'org-1'
const USER = 'user-1'
const baseInput = {
  projectId: 'project-1',
  subject: 'Subject',
  description: 'Description',
  priority: 'medium' as const,
}

describe('rfiService.create — assignee resolution', () => {
  afterEach(() => vi.restoreAllMocks())

  it('writes the explicit assignee and does not look up the project default', async () => {
    const spy = vi.spyOn(projectSettingsService, 'getRfiDefaults')
    const { client, captured } = buildInsertCaptureClient()

    await rfiService.create(client, ORG, USER, { ...baseInput, assignedTo: 'explicit-user' })

    expect(captured.payload.assigned_to).toBe('explicit-user')
    expect(spy).not.toHaveBeenCalled()
  })

  it('falls back to the project default assignee when none is supplied', async () => {
    vi.spyOn(projectSettingsService, 'getRfiDefaults').mockResolvedValue({
      priority: 'medium',
      assigneeId: 'default-user',
      dueDays: null,
    } as any)
    const { client, captured } = buildInsertCaptureClient()

    await rfiService.create(client, ORG, USER, { ...baseInput })

    expect(captured.payload.assigned_to).toBe('default-user')
  })

  it('writes null assigned_to when there is no assignee and no project default', async () => {
    vi.spyOn(projectSettingsService, 'getRfiDefaults').mockResolvedValue({
      priority: 'medium',
      assigneeId: null,
      dueDays: null,
    } as any)
    const { client, captured } = buildInsertCaptureClient()

    await rfiService.create(client, ORG, USER, { ...baseInput })

    expect(captured.payload.assigned_to).toBeNull()
  })

  it('coerces an empty-string due_date to null (DATE column would reject "")', async () => {
    vi.spyOn(projectSettingsService, 'getRfiDefaults').mockResolvedValue({
      priority: 'medium',
      assigneeId: null,
      dueDays: null,
    } as any)
    const { client, captured } = buildInsertCaptureClient()

    await rfiService.create(client, ORG, USER, { ...baseInput, dueDate: '' })

    expect(captured.payload.due_date).toBeNull()
  })
})

/**
 * Migration 00201 narrows projects.rfis UPDATE to callers with an effective
 * role on the RFI's project. A RESTRICTIVE policy that matches no row raises
 * NOTHING — PostgREST returns 200 with an empty array — so a service that only
 * checks `error` reports success for a write that never happened. Mobile is
 * the only caller of these two functions, and its Close button surfaces
 * whatever they throw.
 */
function buildUpdateClient(updatedRows: any[], updateError: any = null) {
  const calls: { table?: string; payload?: any } = {}
  const schema = vi.fn(() => ({
    from: vi.fn((table: string) => {
      calls.table = table
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'resp-1' }, error: null })) })),
        })),
        update: vi.fn((payload: any) => {
          if (table === 'rfis') calls.payload = payload
          return {
            eq: vi.fn(() => ({
              select: vi.fn(async () => ({ data: updatedRows, error: updateError })),
            })),
          }
        }),
      }
    }),
  }))
  return { client: { schema } as any, calls }
}

describe('rfiService.close — a silent policy refusal is not a close', () => {
  it('throws the refusal sentence when the UPDATE matches no row', async () => {
    const { client } = buildUpdateClient([])
    await expect(rfiService.close(client, 'rfi-1', USER)).rejects.toThrow(RFI_CLOSE_REFUSED)
  })

  it('resolves when the UPDATE affected the row', async () => {
    const { client, calls } = buildUpdateClient([{ id: 'rfi-1' }])
    await expect(rfiService.close(client, 'rfi-1', USER)).resolves.toBeUndefined()
    expect(calls.payload).toMatchObject({ status: 'closed', closed_by: USER })
  })

  it('still throws the database error when there is one', async () => {
    const { client } = buildUpdateClient([], { message: 'Only the person who raised RFI-4 … can close it.' })
    await expect(rfiService.close(client, 'rfi-1', USER)).rejects.toThrow(/can close it/)
  })
})

describe('rfiService.respond — the answer survives a refused status flip', () => {
  it('reports status_moved false rather than throwing away the response', async () => {
    const { client } = buildUpdateClient([])
    const res: any = await rfiService.respond(client, { rfiId: 'rfi-1', body: 'Rated 800A.' } as any, USER)
    expect(res.id).toBe('resp-1')
    expect(res.status_moved).toBe(false)
  })

  it('reports status_moved true when the flip took', async () => {
    const { client, calls } = buildUpdateClient([{ id: 'rfi-1' }])
    const res: any = await rfiService.respond(client, { rfiId: 'rfi-1', body: 'Rated 800A.' } as any, USER)
    expect(res.status_moved).toBe(true)
    expect(calls.payload).toEqual({ status: 'responded' })
  })
})
