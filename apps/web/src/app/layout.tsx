import type { Metadata } from 'next'
import { Syne, JetBrains_Mono, Fraunces, IBM_Plex_Mono } from 'next/font/google'
import '@fontsource-variable/mona-sans'
import './globals.css'
import { AnalyticsProvider } from '@/components/providers/AnalyticsProvider'
import { ErrorBoundary } from '@/components/providers/ErrorBoundary'
import { SentryBoot } from '@/components/providers/SentryBoot'

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
  description: 'Construction management for SA electrical contractors',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${syne.variable} ${mono.variable} ${fraunces.variable} ${plexMono.variable}`}>
        <ErrorBoundary>
          <SentryBoot />
          <AnalyticsProvider>
            {children}
          </AnalyticsProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
