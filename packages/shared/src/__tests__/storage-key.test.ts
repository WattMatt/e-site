import { describe, expect, it } from 'vitest'
import { storageKeySegment } from '../utils/storage-key'

describe('storageKeySegment', () => {
  it('flattens repeating-group field ids (the "Invalid key" failure)', () => {
    expect(storageKeySegment('sub_feeds[0].breaker_size')).toBe('sub_feeds_0_.breaker_size')
  })

  it('leaves already-safe segments untouched', () => {
    expect(storageKeySegment('main_board_labelling')).toBe('main_board_labelling')
    expect(storageKeySegment('IMG_2408.jpg')).toBe('IMG_2408.jpg')
  })

  it('replaces spaces, slashes and non-ascii', () => {
    expect(storageKeySegment('Meter photo/é #1.jpg')).toBe('Meter_photo____1.jpg')
  })

  it('never returns an empty segment', () => {
    expect(storageKeySegment('')).toBe('_')
  })
})
