import { describe, it, expect } from 'vitest'
import { readUploadBytes, uploadFailedMessage } from './upload-file'

const readable = (bytes: string, name = 'E-300.pdf') => new File([bytes], name, { type: 'application/pdf' })

/** A file whose reported size is real but whose bytes cannot be read, as a
 *  Dropbox / OneDrive / iCloud online-only placeholder behaves in a browser. */
function placeholder(name: string, size: number): File {
  const f = new File([''], name, { type: 'application/pdf' })
  Object.defineProperty(f, 'size', { value: size })
  Object.defineProperty(f, 'arrayBuffer', { value: () => Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError')) })
  return f
}

describe('readUploadBytes', () => {
  it('returns the bytes it read, typed, for a readable file', async () => {
    const r = await readUploadBytes(readable('%PDF-1.4'), 'application/pdf')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.blob.size).toBe(8)
      expect(r.blob.type).toBe('application/pdf')
    }
  })

  it('an unreadable file (online-only placeholder) is refused with a sentence that says what to do', async () => {
    const r = await readUploadBytes(placeholder('643.E.001 - SITE PLAN.pdf', 2_400_000), 'application/pdf')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('643.E.001 - SITE PLAN.pdf could not be read from this computer')
      expect(r.error).toContain('available offline')
      expect(r.cause).toBeInstanceOf(DOMException)
    }
  })

  it('a file that reads as zero bytes is refused the same way', async () => {
    const r = await readUploadBytes(readable(''), 'application/pdf')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('available offline')
  })

  it('a file that reads shorter than its reported size is refused (partial read)', async () => {
    const f = readable('%PDF')
    Object.defineProperty(f, 'size', { value: 9_000 })
    const r = await readUploadBytes(f, 'application/pdf')
    expect(r.ok).toBe(false)
  })
})

describe('uploadFailedMessage', () => {
  it("carries storage's own reason", () => {
    expect(uploadFailedMessage('E-300.pdf', { message: 'Payload too large' })).toBe('Uploading E-300.pdf failed (Payload too large). Try again.')
  })

  it('a network failure says so', () => {
    expect(uploadFailedMessage('E-300.pdf', { message: 'Failed to fetch' })).toBe(
      'Uploading E-300.pdf failed (the connection to file storage dropped). Check your connection and try again.',
    )
    expect(uploadFailedMessage('E-300.pdf', { message: 'Load failed' })).toContain('connection to file storage dropped')
  })

  it('no reason falls back to the plain sentence, and a long reason is cut', () => {
    expect(uploadFailedMessage('E-300.pdf', null)).toBe('Uploading E-300.pdf failed. Try again.')
    expect(uploadFailedMessage('E-300.pdf', { message: 'x'.repeat(500) }).length).toBeLessThan(200)
  })
})
