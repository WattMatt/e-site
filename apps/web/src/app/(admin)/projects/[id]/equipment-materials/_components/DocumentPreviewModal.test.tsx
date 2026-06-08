import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { DocumentPreviewModal } from './DocumentPreviewModal'

afterEach(() => vi.restoreAllMocks())

describe('DocumentPreviewModal', () => {
  it('fetches the signed URL (inline) and renders a PDF in an iframe', async () => {
    const getUrl = vi.fn().mockResolvedValue({ url: 'https://signed.example/q.pdf' })
    render(<DocumentPreviewModal fileName="quote.pdf" fetchUrl={getUrl} onClose={() => {}} />)
    await waitFor(() => expect(getUrl).toHaveBeenCalledWith(false))
    await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy())
    expect(document.querySelector('iframe')!.getAttribute('src')).toBe('https://signed.example/q.pdf')
  })

  it('renders an image inline for an image file', async () => {
    render(<DocumentPreviewModal fileName="photo.jpg" fetchUrl={async () => ({ url: 'https://x/p.jpg' })} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByAltText('photo.jpg')).toBeTruthy())
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<DocumentPreviewModal fileName="q.pdf" fetchUrl={async () => ({ url: 'https://x/q.pdf' })} onClose={onClose} />)
    await waitFor(() => screen.getByLabelText('Close preview'))
    fireEvent.click(screen.getByLabelText('Close preview'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the error when the signed URL fails', async () => {
    render(<DocumentPreviewModal fileName="q.pdf" fetchUrl={async () => ({ error: 'Access denied' })} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Access denied')).toBeTruthy())
  })
})
