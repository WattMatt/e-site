import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import type { Template } from '@esite/shared'

const { upsertMock, submitMock, calls } = vi.hoisted(() => {
  const calls: string[] = []
  return {
    calls,
    upsertMock: vi.fn(async (input: { fieldId: string }) => {
      calls.push(`save:${input.fieldId}`)
    }),
    submitMock: vi.fn(async () => {
      calls.push('submit')
      return { ok: true }
    }),
  }
})
vi.mock('@/actions/inspections.actions', () => ({ upsertResponseAction: upsertMock, submitInspectionAction: submitMock }))
vi.mock('@/actions/inspections-certify.actions', () => ({ certifyInspectionAction: vi.fn(), sendBackForReinspectionAction: vi.fn() }))
// Inline photo capture on each field reads its photos through the browser client: none here.
vi.mock('@/lib/supabase/client', () => {
  const q: Record<string, unknown> = {}
  for (const m of ['schema', 'from', 'select', 'eq']) q[m] = () => q
  ;(q as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: [] })
  // One instance, like the real browser client: hooks depend on it, so a new one per call loops.
  const client = { ...q, storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } }
  return { createClient: () => client }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), useParams: () => ({ id: 'p-1' }) }))

import CaptureForm from './CaptureForm'

const template = {
  template_id: 't', name: 'T', version: '1', deliverable_type: 'coc',
  sections: [{ section_id: 's1', title: 'Board', fields: [
    { field_id: 'rating', label: 'Rating', type: 'text', required: true, default_value: '63 A' },
  ] }],
} as unknown as Template

const props = {
  inspectionId: 'i-1', projectId: 'p-1', template, initialResponses: [], status: 'in_progress',
  verifierId: 'u-v', currentUserId: 'u-pm', mode: 'capture' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
})

describe('CaptureForm', () => {
  it('opening an inspection writes nothing: a default shown is not an answer given', async () => {
    render(<CaptureForm {...props} />)
    // The default counts on the page...
    expect(screen.getByText('1/1')).toBeTruthy()
    // ...but is not saved by merely looking, which would make the viewer a contributor.
    await new Promise((r) => setTimeout(r, 900))
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('Submit saves pending answers and defaults first, then submits', async () => {
    render(<CaptureForm {...props} />)
    const submit = screen.getByRole('button', { name: /submit for verification/i })
    await act(async () => { fireEvent.click(submit) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /tap again to submit/i })) })
    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    expect(calls).toEqual(['save:rating', 'submit'])
  })

  it('a separate verifier is shown no Submit button', () => {
    render(<CaptureForm {...props} currentUserId="u-v" separateVerifier readOnly />)
    expect(screen.queryByRole('button', { name: /submit for verification/i })).toBeNull()
  })
})
