'use client'

import type { ParsedTemplate } from '@esite/shared'

/**
 * Phase-3 placeholder — the real preview pane replaces this in Phase 5
 * (Capture UX), once the inspector renderer component exists.
 */
export default function TemplatePreviewPane({ template }: { template: ParsedTemplate }) {
  const fieldCount = template.sections.reduce((n, s) => n + s.fields.length, 0)
  return (
    <div
      style={{
        padding: 14,
        background: 'var(--c-panel-2, var(--c-panel))',
        border: '1px solid var(--c-border)',
        borderRadius: 6,
        color: 'var(--c-text-dim)',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <p style={{ fontWeight: 600, color: 'var(--c-text)', marginBottom: 6 }}>Preview pane</p>
      <p style={{ marginBottom: 10 }}>
        Will render the template using the inspector capture component once Phase 5 (Capture UX) lands.
      </p>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
        {template.template_id} · v{template.version} · {template.sections.length}{' '}
        {template.sections.length === 1 ? 'section' : 'sections'} · {fieldCount}{' '}
        {fieldCount === 1 ? 'field' : 'fields'}
      </p>
    </div>
  )
}
