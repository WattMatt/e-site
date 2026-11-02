import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RendererProps } from '../FieldRenderer'
import { PhotoTallyContext, type PhotoTally } from './photo-tally'

vi.mock('./useFieldPhotos', () => ({
  useFieldPhotos: () => ({ photos: [], uploading: false, error: null, upload: vi.fn(), remove: vi.fn() }),
}))
vi.mock('../SignatureModal', () => ({ default: () => null }))

import InlinePhotoCapture from './InlinePhotoCapture'
import SignatureField from './SignatureField'

// Owner report 2026-11-02: the verifier's (read-only) page did not look like the inspector's,
// because empty parts vanished. Every part now stays, saying it is empty.
describe('read-only keeps the same shape', () => {
  it('the photo strip under an answer: "+ Add photo" when editable, "No photo" when read-only', () => {
    const { unmount } = render(<InlinePhotoCapture inspectionId="i" sectionId="s" fieldId="f" readOnly={false} />)
    expect(screen.getByText('+ Add photo')).toBeTruthy()
    unmount()
    render(<InlinePhotoCapture inspectionId="i" sectionId="s" fieldId="f" readOnly />)
    expect(screen.getByText('No photo')).toBeTruthy()
    expect(screen.queryByText('+ Add photo')).toBeNull()
  })

  const sig = (readOnly: boolean, signatures: PhotoTally['signatures'] = []) => {
    const tally = { added: vi.fn(), removed: vi.fn(), signed: vi.fn(), signatures } as unknown as PhotoTally
    const props = {
      field: { field_id: 'insp_sig', label: 'Inspector signature', type: 'signature', required: true },
      inspectionId: 'i', sectionId: 's', readOnly, onChange: vi.fn(),
    } as unknown as RendererProps
    return render(<PhotoTallyContext.Provider value={tally}><SignatureField {...props} /></PhotoTallyContext.Provider>)
  }

  it('a signature: "Sign" when editable, "Not signed yet" when read-only and unsigned', () => {
    const { unmount } = sig(false)
    expect(screen.getByText('✍ Sign')).toBeTruthy()
    unmount()
    sig(true)
    expect(screen.getByText('Not signed yet')).toBeTruthy()
    expect(screen.queryByText('✍ Sign')).toBeNull()
  })

  it('a signed signature reads as signed, never "Not signed yet"', () => {
    sig(true, [{ section_id: 's', field_id: 'insp_sig', signatory_name: 'Ronli', signed_at: '2026-11-02T08:00:00Z' }])
    expect(screen.getByText(/Signed by Ronli/)).toBeTruthy()
    expect(screen.queryByText('Not signed yet')).toBeNull()
  })
})
