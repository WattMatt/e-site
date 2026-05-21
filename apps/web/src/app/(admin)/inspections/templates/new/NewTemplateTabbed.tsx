'use client'

import { useState } from 'react'
import { TemplateBuilderClient } from './TemplateBuilderClient'
import ImportForm from './ImportForm'

const TAB_STYLE_BASE: React.CSSProperties = {
  padding: '6px 16px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  border: '1px solid var(--c-border)',
  borderRadius: 4,
  cursor: 'pointer',
  letterSpacing: '0.04em',
  background: 'none',
}

const TAB_ACTIVE: React.CSSProperties = {
  ...TAB_STYLE_BASE,
  background: 'var(--c-panel)',
  color: 'var(--c-text)',
  borderColor: 'var(--c-text-dim)',
}

const TAB_INACTIVE: React.CSSProperties = {
  ...TAB_STYLE_BASE,
  color: 'var(--c-text-dim)',
  borderColor: 'var(--c-border)',
}

export function NewTemplateTabbed({ organisationId }: { organisationId: string }) {
  const [tab, setTab] = useState<'builder' | 'json'>('builder')

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        <button
          style={tab === 'builder' ? TAB_ACTIVE : TAB_INACTIVE}
          onClick={() => setTab('builder')}
        >
          Builder
        </button>
        <button
          style={tab === 'json' ? TAB_ACTIVE : TAB_INACTIVE}
          onClick={() => setTab('json')}
        >
          JSON paste
        </button>
      </div>

      {tab === 'builder' ? (
        <TemplateBuilderClient organisationId={organisationId} />
      ) : (
        <ImportForm organisationId={organisationId} />
      )}
    </div>
  )
}
