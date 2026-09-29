import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: 'Proposal', robots: { index: false, follow: false } }

/** Public proposal chrome (spec §9.4, D-18): no login, no app navigation. Branding lives in the content. */
export default function ProposalLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <main style={{ maxWidth: 860, margin: '0 auto', background: '#fff', borderRadius: 8, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>{children}</main>
    </div>
  )
}
