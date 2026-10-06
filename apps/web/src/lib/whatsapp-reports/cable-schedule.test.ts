// apps/web/src/lib/whatsapp-reports/cable-schedule.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { policyMock, payloadMock, redactMock, sizeMock, renderMock } = vi.hoisted(() => ({
  policyMock: vi.fn(), payloadMock: vi.fn(), redactMock: vi.fn(), sizeMock: vi.fn(), renderMock: vi.fn(),
}))
vi.mock('@/lib/cable-schedule/export-role', () => ({
  getExportPolicy: (...a: unknown[]) => policyMock(...a),
  redactPayloadCost: (p: unknown) => redactMock(p),
  checkExportSize: (...a: unknown[]) => sizeMock(...a),
}))
vi.mock('@/lib/cable-schedule/export-payload', () => ({
  getRevisionExportPayload: (...a: unknown[]) => payloadMock(...a),
  exportFilenameStem: () => 'KINGSWALK-rev-B',
}))
vi.mock('@/lib/cable-schedule/export-pdf', () => ({ renderRevisionPdf: (p: unknown) => renderMock(p) }))

import { buildCableSchedulePdfForUser, currentRevisionId } from './cable-schedule'

const revisions = (rows: unknown[]) => ({
  schema: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }) }),
}) as never

const REVS = [
  { id: 'r-draft-new', status: 'DRAFT', issued_at: null, created_at: '2026-10-05T00:00:00Z' },
  { id: 'r-issued-old', status: 'ISSUED', issued_at: '2026-08-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z' },
  { id: 'r-issued-new', status: 'ISSUED', issued_at: '2026-09-01T00:00:00Z', created_at: '2026-08-15T00:00:00Z' },
]

beforeEach(() => {
  policyMock.mockReset(); payloadMock.mockReset(); redactMock.mockReset(); sizeMock.mockReset(); renderMock.mockReset()
  payloadMock.mockResolvedValue({ full: true })
  redactMock.mockImplementation((p) => ({ ...p, costRedacted: true }))
  sizeMock.mockReturnValue({ ok: true })
  renderMock.mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
})

describe('currentRevisionId', () => {
  it('prefers the latest issued revision over a newer draft', async () => {
    expect(await currentRevisionId(revisions(REVS), 'p')).toBe('r-issued-new')
  })
  it('falls back to the newest draft, and to null with none', async () => {
    expect(await currentRevisionId(revisions([REVS[0]]), 'p')).toBe('r-draft-new')
    expect(await currentRevisionId(revisions([]), 'p')).toBeNull()
  })
})

describe('buildCableSchedulePdfForUser', () => {
  it('gates the named person first and reads nothing when they have no access', async () => {
    policyMock.mockResolvedValue({ canExport: false, redactCost: false, reason: 'No access to this project' })
    const out = await buildCableSchedulePdfForUser(revisions(REVS), 'u1', 'p1')
    expect(out).toEqual({ code: 'no_access', message: 'No access to this project' })
    expect(policyMock).toHaveBeenCalledWith(expect.anything(), 'u1', 'p1')
    expect(payloadMock).not.toHaveBeenCalled()
  })

  it('redacts cost for a site role, as the web export does', async () => {
    policyMock.mockResolvedValue({ canExport: true, redactCost: true, role: 'contractor' })
    const out = await buildCableSchedulePdfForUser(revisions(REVS), 'u1', 'p1')
    expect(payloadMock).toHaveBeenCalledWith(expect.anything(), 'p1', 'r-issued-new')
    expect(renderMock).toHaveBeenCalledWith({ full: true, costRedacted: true })
    expect(out).toEqual({ code: 'ok', filename: 'KINGSWALK-rev-B.pdf', bytes: new Uint8Array([37, 80, 68, 70]) })
  })

  it('keeps cost for owner/admin/PM', async () => {
    policyMock.mockResolvedValue({ canExport: true, redactCost: false, role: 'admin' })
    await buildCableSchedulePdfForUser(revisions(REVS), 'u1', 'p1')
    expect(redactMock).not.toHaveBeenCalled()
    expect(renderMock).toHaveBeenCalledWith({ full: true })
  })

  it('reports none without a revision, and too_large past the PDF cap', async () => {
    policyMock.mockResolvedValue({ canExport: true, redactCost: false, role: 'admin' })
    expect((await buildCableSchedulePdfForUser(revisions([]), 'u1', 'p1')).code).toBe('none')
    sizeMock.mockReturnValue({ ok: false, reason: 'too many cables', status: 413 })
    expect(await buildCableSchedulePdfForUser(revisions(REVS), 'u1', 'p1')).toEqual({ code: 'too_large', message: 'too many cables' })
    expect(renderMock).not.toHaveBeenCalled()
  })
})
