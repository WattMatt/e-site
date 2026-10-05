import type { Metadata, Viewport } from 'next'
import { Syne, JetBrains_Mono, Fraunces, IBM_Plex_Mono } from 'next/font/google'
import '@fontsource-variable/mona-sans'
import './globals.css'
import { AnalyticsProvider } from '@/components/providers/AnalyticsProvider'
import { ErrorBoundary } from '@/components/providers/ErrorBoundary'
import { SentryBoot } from '@/components/providers/SentryBoot'
import { AuthHashErrorRedirect } from '@/components/auth/AuthHashErrorRedirect'
import { cookies } from 'next/headers'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { parseThemeMode, resolveDataTheme } from '@/lib/theme/resolve'
import { THEME_COOKIE } from '@/lib/theme/types'
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar'
import { PWA_BRAND } from '@/lib/pwa/brand'
import { splashStartupImages } from '@/lib/pwa/splash'

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

// JBCC "Procedural" type system — added alongside existing fonts, not replacing
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz', 'SOFT'],
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-mono-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s — E-Site',
    default: 'E-Site — Construction Management',
  },
  description: PWA_BRAND.description,
  applicationName: PWA_BRAND.name,
  // Installable web app (E2). The manifest link is added by app/manifest.ts.
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: PWA_BRAND.name,
    // 'default' keeps content BELOW an opaque status bar, so no page — public,
    // auth or app — can draw under the clock. 'black-translucent' would need
    // safe-area padding on every layout, not just the app shell.
    statusBarStyle: 'default',
    startupImage: splashStartupImages(),
  },
  formatDetection: { telephone: false },
  // Next 15 emits only the standard mobile-web-app-capable tag for
  // appleWebApp.capable; older iOS needs the apple- prefixed one before it
  // honours the apple-touch-startup-image launch screens.
  other: { 'apple-mobile-web-app-capable': 'yes' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the phone tab bar sit above the home indicator via
  // env(safe-area-inset-bottom) instead of under it.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: PWA_BRAND.surfaceDark },
    { media: '(prefers-color-scheme: light)', color: PWA_BRAND.surfaceLight },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const mode = parseThemeMode(cookieStore.get(THEME_COOKIE)?.value)
  const dataTheme = resolveDataTheme(mode)

  return (
    <html lang="en" data-theme={dataTheme ?? undefined} suppressHydrationWarning>
      <body className={`${syne.variable} ${mono.variable} ${fraunces.variable} ${plexMono.variable}`}>
        <ErrorBoundary>
          <SentryBoot />
          <ServiceWorkerRegistrar />
          <AuthHashErrorRedirect />
          <ThemeProvider initialMode={mode}>
            <AnalyticsProvider>
              {children}
            </AnalyticsProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
