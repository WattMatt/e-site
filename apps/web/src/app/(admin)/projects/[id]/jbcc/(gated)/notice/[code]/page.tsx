import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getNotice, getNoticeFields } from '@esite/shared'

interface PageProps {
  params: Promise<{ id: string; code: string }>
}

export default async function NoticeDetailPage({ params }: PageProps) {
  const { id: projectId, code } = await params
  const supabase = await createClient()

  const notice = await getNotice(supabase, code)
  if (!notice) notFound()

  const fields = await getNoticeFields(supabase, notice.id)
  const manualFields = fields.filter(f => f.source === 'manual')

  return (
    <div
      className="jbcc-page-fade"
      style={{ maxWidth: 860, margin: '0 auto', padding: '48px 40px 96px' }}
    >
      {/* Back breadcrumb — mono small */}
      <Link
        href={`/projects/${projectId}/jbcc`}
        style={{
          display: 'inline-block',
          fontFamily: 'var(--f-mono-display)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--c-text-muted)',
          textDecoration: 'none',
          marginBottom: 32,
          transition: 'color .15s',
        }}
        className="jbcc-back-link"
      >
        ← Notice Library
      </Link>

      {/* Eyebrow — notice code in amber mono */}
      <div
        style={{
          fontFamily: 'var(--f-mono-display)',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.24em',
          color: 'var(--c-amber)',
          textTransform: 'uppercase',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {notice.code}
        <span
          style={{
            height: 1,
            flex: 1,
            background: 'linear-gradient(90deg, var(--c-amber-mid-rgb, rgba(232,146,58,.32)), transparent)',
            maxWidth: 80,
          }}
        />
      </div>

      {/* Title — Fraunces italic */}
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontWeight: 350,
          fontSize: 'clamp(28px, 4vw, 52px)',
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          color: 'var(--c-text)',
          fontVariationSettings: "'opsz' 72, 'SOFT' 30",
          marginBottom: 16,
          margin: '0 0 16px',
        }}
      >
        {notice.title}
      </h1>

      {/* Direction + contract meta */}
      <p
        style={{
          fontFamily: 'var(--f-mono-display)',
          fontSize: 11,
          color: 'var(--c-text-muted)',
          letterSpacing: '0.06em',
          borderTop: '1px solid var(--c-border)',
          paddingTop: 14,
          marginBottom: 40,
        }}
      >
        {notice.from_party} → {notice.to_party}
        <span style={{ color: 'var(--c-border-mid, #3A3A52)', margin: '0 10px' }}>·</span>
        {notice.contract} {notice.edition}
      </p>

      {/* Metadata grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0 40px',
          marginBottom: 40,
        }}
      >
        <div className="jbcc-panel" style={{ gridColumn: 'auto' }}>
          <div className="jbcc-panel-title">Triggering clause</div>
          <p style={{ fontFamily: 'var(--f-mono-display)', fontSize: 13, color: 'var(--c-text)', letterSpacing: '0.02em' }}>
            {notice.triggering_clause}
          </p>
        </div>
        <div className="jbcc-panel" style={{ gridColumn: 'auto' }}>
          <div className="jbcc-panel-title">Time-bar</div>
          <p style={{ fontSize: 13, color: 'var(--c-text)', lineHeight: 1.5 }}>
            {notice.time_bar_text}
          </p>
        </div>
        <div className="jbcc-panel" style={{ gridColumn: '1 / -1' }}>
          <div className="jbcc-panel-title">Purpose</div>
          <p style={{ fontSize: 14, color: 'var(--c-text)', lineHeight: 1.6 }}>
            {notice.purpose}
          </p>
        </div>

        {/* Consequence of failure — red-accented panel */}
        <div
          style={{
            gridColumn: '1 / -1',
            background: 'var(--c-red-dim-rgb, rgba(255,107,107,.10))',
            border: '1px solid var(--c-red)',
            borderLeft: '3px solid var(--c-red-bright)',
            padding: 24,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-mono-display)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--c-red-bright)',
              marginBottom: 12,
            }}
          >
            Consequence of failure to issue
          </div>
          <p
            style={{
              fontSize: 14,
              color: 'var(--c-text)',
              lineHeight: 1.6,
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontWeight: 350,
              fontVariationSettings: "'opsz' 36",
            }}
          >
            {notice.consequence_of_failure}
          </p>
        </div>
      </div>

      {/* Generate letter CTA */}
      <div style={{ marginBottom: 48 }}>
        <Link
          href={`/projects/${projectId}/jbcc/notice/${notice.code}/new`}
          className="jbcc-btn-cta"
          style={{
            display: 'inline-block',
            textDecoration: 'none',
            background: 'var(--c-amber)',
            color: 'var(--c-base)',
            borderColor: 'var(--c-amber)',
            fontFamily: 'var(--f-mono-display)',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '12px 24px',
            border: '1px solid',
            borderRadius: 1,
          }}
        >
          Generate Letter →
        </Link>
      </div>

      {/* Manual fields preview */}
      {manualFields.length > 0 && (
        <section>
          <div
            style={{
              fontFamily: 'var(--f-mono-display)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--c-amber)',
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: '1px solid var(--c-border)',
            }}
          >
            Fields you will fill in
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 1, background: 'var(--c-border)' }}>
            {manualFields.map(f => (
              <li
                key={f.id}
                style={{
                  background: 'var(--c-surface)',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--c-text)' }}>{f.label}</span>
                <span
                  style={{
                    fontFamily: 'var(--f-mono-display)',
                    fontSize: 10,
                    color: 'var(--c-text-muted)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  {f.field_type}
                  {f.required ? ' ·' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
