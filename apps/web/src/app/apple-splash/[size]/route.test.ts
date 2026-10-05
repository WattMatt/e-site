// @vitest-environment node
/**
 * Renders the REAL route for every linked launch image and reads the PNG's own
 * header: each <link> must resolve to an image of exactly the device's pixel
 * size, or iOS silently shows a blank launch screen.
 */
import { describe, it, expect } from 'vitest'
import { GET } from './route'
import { splashStartupImages, SPLASH_DEVICES } from '@/lib/pwa/splash'

async function png(size: string) {
  const r = await GET(new Request(`https://x/apple-splash/${size}`), { params: Promise.resolve({ size }) })
  const b = Buffer.from(await r.arrayBuffer())
  return { status: r.status, type: r.headers.get('content-type'), w: b.readUInt32BE(16), h: b.readUInt32BE(20), sig: b.subarray(1, 4).toString('latin1') }
}

describe('apple-splash route', () => {
  it.each(splashStartupImages().map((l, i) => [l.url, SPLASH_DEVICES[i]] as const))(
    '%s renders a PNG at the device’s pixel size',
    async (url, d) => {
      const out = await png(url.replace('/apple-splash/', ''))
      expect(out.status).toBe(200)
      expect(out.type).toBe('image/png')
      expect(out.sig).toBe('PNG')
      expect({ w: out.w, h: out.h }).toEqual({ w: d.width * d.ratio, h: d.height * d.ratio })
    },
    30_000,
  )

  it('refuses a size it does not publish', async () => {
    await expect(GET(new Request('https://x/apple-splash/9x9.png'), { params: Promise.resolve({ size: '9x9.png' }) })).rejects.toThrow()
  })
})
