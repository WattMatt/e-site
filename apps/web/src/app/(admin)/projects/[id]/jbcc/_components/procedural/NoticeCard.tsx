'use client'

import Link from 'next/link'
import { type CSSProperties } from 'react'

interface NoticeCardProps {
  code: string
  title: string
  summary?: string | null
  timeBarLabel: string      // e.g. "Promptly" or "15 WD"
  clauseRef: string         // e.g. "cl. 14.0 / 17.1"
  direction: string         // e.g. "Contractor → PA"
  href: string
  /** 'active' shows amber top bar + status badge instead of direction */
  activeLetterCount?: number
  /** 'overdue' — red status dot + red time-bar label */
  isOverdue?: boolean
}

/**
 * Sharp-edged notice card for the JBCC grid.
 * 1px gutter grid, no border-radius — matches .card from the Procedural mockup.
 * Uses a hover CSS class via a <style> tag; we keep it here co-located.
 */
export function NoticeCard({
  code,
  title,
  summary,
  timeBarLabel,
  clauseRef,
  direction,
  href,
  activeLetterCount,
  isOverdue,
}: NoticeCardProps) {
  const hasActive = (activeLetterCount ?? 0) > 0 || isOverdue

  const cardStyle: CSSProperties = {
    background: 'var(--c-surface)',
    padding: '28px 24px 24px',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    cursor: 'pointer',
    textDecoration: 'none',
    color: 'inherit',
    minHeight: 220,
    transition: 'background .15s ease',
  }

  return (
    <Link href={href} style={cardStyle} className="jbcc-notice-card">
      {/* Active amber top bar */}
      {hasActive && (
        <span
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: isOverdue ? 'var(--c-red-bright)' : 'var(--c-amber)',
          }}
        />
      )}

      {/* Code + time-bar row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontFamily: 'var(--f-mono-display)',
          fontSize: 11,
          letterSpacing: '0.04em',
          marginBottom: 18,
        }}
      >
        <span
          style={{
            color: 'var(--c-text)',
            fontWeight: 500,
            fontSize: 13,
          }}
        >
          {code}
        </span>
        <span style={{ color: 'var(--c-text-muted)', fontSize: 11 }}>
          <strong
            style={{
              color: isOverdue ? 'var(--c-red-bright)' : 'var(--c-amber)',
              fontWeight: 500,
            }}
          >
            {timeBarLabel}
          </strong>
          {clauseRef ? ` · ${clauseRef}` : ''}
        </span>
      </div>

      {/* Fraunces title */}
      <h3
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 400,
          fontSize: 19,
          lineHeight: 1.2,
          letterSpacing: '-0.015em',
          color: 'var(--c-text)',
          marginBottom: 12,
          fontVariationSettings: "'opsz' 36",
          margin: '0 0 12px',
        }}
      >
        {title}
      </h3>

      {/* Summary — Mona Sans italic */}
      {summary && (
        <p
          style={{
            fontFamily: 'var(--f-body-jbcc)',
            fontStyle: 'italic',
            fontWeight: 380,
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--c-text-muted)',
            marginBottom: 'auto',
            paddingBottom: 16,
            margin: '0 0 auto',
          }}
        >
          {summary}
        </p>
      )}
      {/* Spacer when no summary */}
      {!summary && <div style={{ flex: 1 }} />}

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontFamily: 'var(--f-mono-display)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--c-text-muted)',
          paddingTop: 14,
          borderTop: '1px solid var(--c-border)',
        }}
      >
        {/* Status badge or direction */}
        {isOverdue ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--c-red-bright)',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                background: 'var(--c-red-bright)',
                borderRadius: '50%',
                display: 'inline-block',
              }}
            />
            Overdue
          </span>
        ) : (activeLetterCount ?? 0) > 0 ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--c-amber)',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                background: 'var(--c-amber)',
                borderRadius: '50%',
                display: 'inline-block',
              }}
            />
            {activeLetterCount} In Flight
          </span>
        ) : (
          <span>{direction}</span>
        )}

        {/* Arrow */}
        <span
          className="jbcc-card-arrow"
          style={{
            color: 'var(--c-amber)',
            fontFamily: 'var(--f-body-jbcc)',
            letterSpacing: 0,
            textTransform: 'none',
            fontSize: 13,
            opacity: 0.7,
            transition: 'all .2s',
          }}
        >
          Open ↗
        </span>
      </div>
    </Link>
  )
}
