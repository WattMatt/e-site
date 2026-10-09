import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: 'Tender', robots: { index: false, follow: false } }

/**
 * Tenderer portal chrome (E5 slice B): no app navigation. A tenderer has no
 * organisation and sees nothing of E-Site beyond the tenders they were invited to.
 */
export default function TenderLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--c-base, #f8fafc)', color: 'var(--c-text, #0f172a)', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <main style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 16 }}>{children}</main>
    </div>
  )
}
