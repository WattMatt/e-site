import { ImageResponse } from 'next/og'
import { notFound } from 'next/navigation'
import { PWA_BRAND } from '@/lib/pwa/brand'
import { SPLASH_DEVICES, parseSplashFile, splashFile } from '@/lib/pwa/splash'

// Every size is rendered once at build time; nothing renders per request.
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return SPLASH_DEVICES.map(d => ({ size: splashFile(d) }))
}

/** iOS launch screen: the E-Site mark centred on the app's dark base. */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params
  const dims = parseSplashFile(size)
  if (!dims) notFound()
  const tile = Math.round(Math.min(dims.width, dims.height) * 0.22)
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: PWA_BRAND.base }}>
        <div style={{ width: tile, height: tile, borderRadius: tile * 0.22, background: PWA_BRAND.amber, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 20 20" width={tile * 0.62} height={tile * 0.62}>
            <path d="M10 2L17 7V18H13V12H7V18H3V7L10 2Z" fill={PWA_BRAND.base} />
          </svg>
        </div>
        <div style={{ marginTop: tile * 0.3, color: '#EDE8DF', fontSize: Math.round(tile * 0.28), fontWeight: 700, letterSpacing: -1 }}>
          {PWA_BRAND.name}
        </div>
      </div>
    ),
    dims,
  )
}
