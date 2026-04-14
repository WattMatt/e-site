import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Suspense } from 'react'
import './globals.css'
import { AnalyticsProvider } from '@/components/providers/AnalyticsProvider'
import { ErrorBoundary } from '@/components/providers/ErrorBoundary'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'E-Site',
  description: 'Construction management for SA electrical contractors',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ErrorBoundary>
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
