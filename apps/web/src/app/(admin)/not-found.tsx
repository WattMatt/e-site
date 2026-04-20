import type { Metadata } from 'next'
import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata: Metadata = { title: 'Page Not Found' }

export default function AdminNotFound() {
  return (
    <main id="main-content" style={{ padding: '48px 24px' }}>
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The page you're looking for doesn't exist or you don't have permission to view it."
        action={
          <Link
            href="/dashboard"
            style={{
              padding: '8px 20px', borderRadius: 6,
              background: 'var(--c-amber)', color: 'var(--c-base)',
              fontSize: 13, fontWeight: 600, textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Back to Dashboard
          </Link>
        }
      />
    </main>
  )
}
