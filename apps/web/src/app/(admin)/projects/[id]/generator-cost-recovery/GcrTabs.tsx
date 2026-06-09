'use client'

import { useState } from 'react'
import type { GcrConfig } from './gcr.actions'
import { SettingsForm } from './SettingsForm'

type Tab = 'settings' | 'zones' | 'tenants'

interface GcrTabsProps {
  projectId: string
  data: GcrConfig
}

export function GcrTabs({ projectId, data }: GcrTabsProps) {
  const [active, setActive] = useState<Tab>('settings')

  return (
    <div>
      {/* Tab bar */}
      <nav
        aria-label="Generator cost-recovery sections"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--c-border)',
          marginBottom: 18,
          paddingBottom: 0,
        }}
      >
        {(
          [
            { id: 'settings', label: 'Settings' },
            { id: 'zones',    label: 'Zones & Generators' },
            { id: 'tenants',  label: 'Tenants' },
          ] as { id: Tab; label: string }[]
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            aria-current={active === id ? 'page' : undefined}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: active === id ? 'var(--c-text-on-amber)' : 'var(--c-text-mid)',
              background: active === id ? 'var(--c-amber)' : 'transparent',
              borderRadius: '6px 6px 0 0',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Tab panels */}
      {active === 'settings' && (
        <SettingsForm projectId={projectId} settings={data.settings} />
      )}

      {active === 'zones' && (
        <div
          style={{
            padding: '32px 18px',
            textAlign: 'center',
            color: 'var(--c-text-dim)',
            fontSize: 13,
            fontStyle: 'italic',
          }}
        >
          Zones &amp; generators — configured next
        </div>
      )}

      {active === 'tenants' && (
        <div
          style={{
            padding: '32px 18px',
            textAlign: 'center',
            color: 'var(--c-text-dim)',
            fontSize: 13,
            fontStyle: 'italic',
          }}
        >
          Tenant assignment — configured next
        </div>
      )}
    </div>
  )
}
