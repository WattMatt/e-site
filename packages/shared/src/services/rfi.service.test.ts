import { describe, it, expect, vi, afterEach } from 'vitest'
import { rfiService } from './rfi.service'
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
