import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listNotices, listClauses, listTimeBars, listLetters } from '@esite/shared'
import { ReferenceTabs } from '../_components/ReferenceTabs'
import { DeadlineStrip } from '../_components/DeadlineStrip'
import { PageHero } from '../_components/procedural/PageHero'

export const metadata: Metadata = { title: 'JBCC Procedural Toolkit' }

interface PageProps {
  params:       Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}

export default async function JbccLibraryPage({ params, searchParams }: PageProps) {
  const { id: projectId } = await params
  const { view }          = await searchParams

  const supabase = await createClient()
  const [notices, clauses, timebars, letters] = await Promise.all([
    listNotices(supabase),
    listClauses(supabase),
    listTimeBars(supabase),
    listLetters(supabase, projectId),
  ])

  return (
    // jbcc-shell applies the stagger-on-load animation to each direct child
    <div className="jbcc-shell" style={{ padding: '56px 48px 96px', maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
      {/* Drafting-paper dimension marker — amber corner tick (decorative) */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 32,
          left: 32,
          width: 24,
          height: 24,
          borderTop: '1px solid var(--c-amber)',
          borderLeft: '1px solid var(--c-amber)',
          opacity: 0.6,
          pointerEvents: 'none',
        }}
      />

      {/* Page hero — eyebrow, Fraunces italic title, meta line */}
      <PageHero
        eyebrow={`JBCC Procedural`}
        title={<>Notice<br />Library<span style={{ color: 'var(--c-amber)' }}>.</span></>}
        meta={[
          { label: 'NOTICES',   value: notices.length },
          { label: 'CLAUSES',   value: clauses.length },
          { label: 'TIME-BARS', value: timebars.length },
        ]}
      />

      {/* Letterhead setup affordance — branding is applied to every generated notice */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', margin: '4px 0 8px' }}>
        <Link
          href="/settings/branding"
          style={{
            fontFamily: 'var(--f-mono-display)', fontSize: 10, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--c-amber)', textDecoration: 'none',
            border: '1px solid var(--c-border)', padding: '7px 12px', borderRadius: 1,
          }}
        >
          Set up branded letterhead →
        </Link>
        <span style={{ fontFamily: 'var(--f-mono-display)', fontSize: 10.5, color: 'var(--c-text-muted)', letterSpacing: '0.03em' }}>
          Your logo, address &amp; registration numbers are composited onto every generated notice.
        </span>
      </div>

      {/* Urgency hero — only shown when deadlines are critical */}
      <DeadlineStrip projectId={projectId} letters={letters} notices={notices} />

      {/* Tabbed reference views */}
      <ReferenceTabs
        projectId={projectId}
        initialView={view ?? 'notices'}
        notices={notices}
        clauses={clauses}
        timebars={timebars}
        letters={letters}
      />
    </div>
  )
}
