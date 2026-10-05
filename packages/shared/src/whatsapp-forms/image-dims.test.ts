import { describe, expect, it } from 'vitest'
import { imageInfo } from './image-dims'

/** Minimal valid-header JPEG: SOI, APP0 stub, SOF0 with a given size. */
function jpeg(width: number, height: number, sof = 0xc0): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, length 4
    0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
}

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  return b
}

describe('imageInfo', () => {
  it('reads a baseline JPEG size', () => expect(imageInfo(jpeg(1600, 1200))).toEqual({ mime: 'image/jpeg', width: 1600, height: 1200 }))
  it('reads a progressive JPEG size', () => expect(imageInfo(jpeg(900, 1600, 0xc2))).toEqual({ mime: 'image/jpeg', width: 900, height: 1600 }))
  it('reads a PNG size', () => expect(imageInfo(png(640, 480))).toEqual({ mime: 'image/png', width: 640, height: 480 }))
  it('trusts the bytes, not a claimed mime type', () => {
    expect(imageInfo(new TextEncoder().encode('<html>not an image</html>'))).toBeNull()
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull()
  })
  it('does not mistake a DHT/DQT marker for a frame header', () => {
    const b = jpeg(1, 1)
    b[9] = 0xc4 // turn the SOF into a DHT; no frame header left
    expect(imageInfo(b)).toBeNull()
  })
})
