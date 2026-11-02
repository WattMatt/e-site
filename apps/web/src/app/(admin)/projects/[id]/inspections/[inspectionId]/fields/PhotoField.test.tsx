import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Field } from '@esite/shared'

vi.mock('./useFieldPhotos', () => ({
  useFieldPhotos: () => ({ photos: [], uploading: false, error: null, upload: vi.fn(), remove: vi.fn() }),
}))
vi.mock('./PhotoMarkupDialog', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'p-1' }) }))

import PhotoField from './PhotoField'

const field = { field_id: 'board_open', label: 'Board (Open)', type: 'photo', required: true, assess: true } as unknown as Field
const base = { field, inspectionId: 'i-1', sectionId: 's1', onChange: vi.fn() }

// Owner report 2026-11-02 (DB-10): the verifier's page dropped the photo slot and the comment box,
// so it "doesn't even appear the same" as the inspector's. Read-only keeps the same shape.
describe('PhotoField: read-only has the same shape as the form being filled in', () => {
  it('editable: a photo slot, Pass / Fail / N/A and a comment box', () => {
    render(<PhotoField {...base} readOnly={false} />)
    expect(screen.getByText('+ Add photo')).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('textbox', { name: 'Comment' })).toBeTruthy()
  })

  it('read-only: the same three parts, each saying it is empty, nothing editable', () => {
    render(<PhotoField {...base} readOnly />)
    expect(screen.getByText('No photo yet')).toBeTruthy()
    expect(screen.queryByText('+ Add photo')).toBeNull()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    radios.forEach((r) => expect((r as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText('No comment')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('read-only shows a written comment', () => {
    render(<PhotoField {...base} readOnly response={{ section_id: 's1', field_id: 'board_open', value_text: 'Cover missing' } as never} />)
    expect(screen.getByText('Cover missing')).toBeTruthy()
  })
})
