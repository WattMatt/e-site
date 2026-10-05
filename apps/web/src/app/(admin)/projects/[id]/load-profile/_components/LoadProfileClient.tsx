'use client'
/**
 * The Load profile tab. Draws the server-composed view; computes nothing. Empty state carries the
 * calls to action (a feature reachable only by deep link is not reachable — PR #159).
 */
import type { LoadProfileView } from '@/lib/load-profile/view-types'
import { SourcesPanel } from './SourcesPanel'
import { SettingsPanel } from './SettingsPanel'
import { OutputsPanel } from './OutputsPanel'

export interface ArchetypeOption { code: string; name: string }

export function LoadProfileClient({ view, archetypes }: { view: LoadProfileView; archetypes: ArchetypeOption[] }) {
  const exportHref = (format: 'xlsx' | 'pdf') => `/api/projects/${view.projectId}/load-profile/export?format=${format}`
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Load profile</h1>
          <p className="page-subtitle">
            Meter exports and tenant-schedule estimates for {view.projectName || 'this project'}: profile, peaks, energy, NMD and time-of-use cost.
          </p>
        </div>
        {view.analysis && (
          <div style={{ display: 'flex', gap: 8 }}>
            <a className="btn" href={exportHref('xlsx')}>Export Excel</a>
            <a className="btn" href={exportHref('pdf')}>Export PDF</a>
          </div>
        )}
      </div>

      <SourcesPanel view={view} archetypes={archetypes} />

      {view.analysis ? (
        <>
          <SettingsPanel view={view} />
          <OutputsPanel view={view} />
        </>
      ) : (
        <div className="card empty-state" style={{ marginTop: 16 }}>
          <h2>No load profile yet</h2>
          <p>
            {view.canEdit
              ? 'Upload a meter export (PnP SCADA power or energy profile, or a sep= portal export) or build an estimate from the tenant schedule above. The profile, peaks, energy and cost appear here.'
              : 'Nobody has added meter data or an estimate to this project yet. An owner, admin or project manager can add one.'}
          </p>
        </div>
      )}
    </div>
  )
}
