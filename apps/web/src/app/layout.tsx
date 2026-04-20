import type { Metadata } from 'next'
import { Syne, JetBrains_Mono } from 'next/font/google'
import { Suspense } from 'react'
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
      <body className={`${syne.variable} ${mono.variable}`}>
        <ErrorBoundary>
          <SentryBoot />
          <Suspense fallback={null}>
            <AnalyticsProvider>
              {children}
            </AnalyticsProvider>
          </Suspense>
        </ErrorBoundary>
      </body>
    </html>
  )
}
