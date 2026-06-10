'use client'

import { useState } from 'react'
import type { GcrReportRevisionRow } from '@esite/shared'
import type { GcrConfig } from './gcr.actions'
import { SettingsForm } from './SettingsForm'
import { ZonesPanel } from './ZonesPanel'
import { TenantsPanel } from './TenantsPanel'
import { ReportsPanel } from './ReportsPanel'

type Tab = 'settings' | 'zones' | 'tenants' | 'reports'

interface GcrTabsProps {
  projectId: string
  data: GcrConfig
  reportRevisions: GcrReportRevisionRow[]
}

export function GcrTabs({ projectId, data, reportRevisions }: GcrTabsProps) {
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
            { id: 'reports',  label: 'Reports' },
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
        <ZonesPanel projectId={projectId} zones={data.zones} generators={data.generators} />
      )}

      {active === 'tenants' && (
        <TenantsPanel
          projectId={projectId}
          settings={data.settings}
          zones={data.zones}
          generators={data.generators}
          tenants={data.tenants}
          assignments={data.assignments}
          onNavigateToReports={() => setActive('reports')}
        />
      )}

      {active === 'reports' && (
        <ReportsPanel
          projectId={projectId}
          revisions={reportRevisions}
          settings={data.settings}
          zones={data.zones}
          generators={data.generators}
          tenants={data.tenants}
        />
      )}
    </div>
  )
}
