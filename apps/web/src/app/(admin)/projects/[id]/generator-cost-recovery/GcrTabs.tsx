'use client'

import { useState } from 'react'
import type { GcrConfig } from './gcr.actions'
import { SettingsForm } from './SettingsForm'
import { ZonesPanel } from './ZonesPanel'
import { TenantsPanel } from './TenantsPanel'

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <ZonesPanel projectId={projectId} zones={data.zones as any} generators={data.generators as any} />
      )}

      {active === 'tenants' && (
        <TenantsPanel
          projectId={projectId}
          settings={data.settings}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          zones={data.zones as any}
          generators={data.generators}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tenants={data.tenants as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          assignments={data.assignments as any}
        />
      )}
    </div>
  )
}
