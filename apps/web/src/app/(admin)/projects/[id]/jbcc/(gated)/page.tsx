import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'JBCC Procedural Toolkit' }

/**
 * Placeholder landing for the JBCC notice library.
 * Phase 3 replaces this with the full notice-type browser.
 */
export default function JbccLibraryPage() {
  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">JBCC Procedural Toolkit</h1>
          <p className="page-subtitle">Notice library coming in the next phase.</p>
        </div>
      </div>
    </div>
  )
}
