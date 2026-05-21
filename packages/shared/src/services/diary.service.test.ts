import { describe, it, expect } from 'vitest'
import { attachmentKindFromMime } from './diary.service'

describe('attachmentKindFromMime', () => {
  it('classifies images', () => {
    expect(attachmentKindFromMime('image/jpeg')).toBe('image')
    expect(attachmentKindFromMime('image/png')).toBe('image')
    expect(attachmentKindFromMime('image/heic')).toBe('image')
  })
  it('classifies video', () => {
    expect(attachmentKindFromMime('video/mp4')).toBe('video')
    expect(attachmentKindFromMime('video/quicktime')).toBe('video')
  })
  it('classifies everything else as document', () => {
    expect(attachmentKindFromMime('application/pdf')).toBe('document')
    expect(attachmentKindFromMime('application/vnd.ms-excel')).toBe('document')
    expect(attachmentKindFromMime('')).toBe('document')
  })
})
