'use client'

/**
 * ValuationsTab — the Valuations tab shell (client master-detail).
 *
 * Master: ValuationsList (the valuation sequence + New valuation). Detail: the
 * selected valuation's progress capture (ValuationDetail) topped by the
 * CertifyBar. The static BOQ tree (sections/items) comes from the server page;
 * the per-valuation lines + live certificate are fetched on selection via
 * getValuationAction and re-fetched after every write so the figures stay live.
 *
 * Prop contract (set by the server page):
 *   <ValuationsTab projectId canEdit valuations={…} sections={…} items={…} />
 */

import { useCallback, useEffect, useState } from 'react'
import type { BoqItem, BoqSection, Valuation, ValuationLine } from '@esite/shared'
import { listValuationsAction, getValuationAction } from '@/actions/valuation.actions'
import { ValuationsList } from './ValuationsList'
import { ValuationDetail } from './ValuationDetail'
import { CertifyBar } from './CertifyBar'

interface DetailState {
  valuation: Valuation
  lines: ValuationLine[]
  /** Revised amount per boqItemId — null entry means no approved adjustment for that item. */
  revisedByItem: Map<string, number | null>
  certificate: {
    grossToDate: number
    retention: number
    netToDate: number
    previousNet: number
    dueExVat: number
    vat: number
    dueInclVat: number
  }
  certifiedByName: string | null
}

interface Props {
  projectId: string
  canEdit: boolean
  valuations: Valuation[]
  sections: BoqSection[]
  items: BoqItem[]
}

export function ValuationsTab({ projectId, canEdit, valuations: initialValuations, sections, items }: Props) {
  const [valuations, setValuations] = useState<Valuation[]>(initialValuations)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshList = useCallback(async () => {
    const res = await listValuationsAction(projectId)
    if ('data' in res) setValuations(res.data.valuations)
  }, [projectId])

  const loadDetail = useCallback(
    async (valuationId: string) => {
      setLoadingDetail(true)
      setLoadError(null)
      const res = await getValuationAction(projectId, valuationId)
      setLoadingDetail(false)
      if ('error' in res) {
        setLoadError(res.error)
        setDetail(null)
        return
      }
      const revisedByItem = new Map<string, number | null>()
      for (const l of res.data.lines) {
        revisedByItem.set(l.boqItemId, l.revisedAmount)
      }
      setDetail({
        valuation: res.data.valuation,
        lines: res.data.lines,
        certificate: res.data.certificate,
        certifiedByName: res.data.certifiedByName,
        revisedByItem,
      })
    },
    [projectId],
  )

  // Load the detail whenever the selection changes.
  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
    else setDetail(null)
  }, [selectedId, loadDetail])

  // After a write inside the detail, re-fetch both the detail and the list (the
  // list shows status + frozen totals that certify changes).
  const handleChanged = useCallback(() => {
    if (selectedId) void loadDetail(selectedId)
    void refreshList()
  }, [selectedId, loadDetail, refreshList])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ValuationsList
        projectId={projectId}
        valuations={valuations}
        canEdit={canEdit}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreated={refreshList}
      />

      {selectedId && (
        <div>
          {loadingDetail && !detail ? (
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>Loading valuation…</p>
          ) : loadError ? (
            <p style={{ fontSize: 13, color: 'var(--c-red)' }}>{loadError}</p>
          ) : detail ? (
            <ValuationDetail
              projectId={projectId}
              valuation={detail.valuation}
              lines={detail.lines}
              revisedByItem={detail.revisedByItem}
              sections={sections}
              items={items}
              certificate={detail.certificate}
              canEdit={canEdit}
              onChanged={handleChanged}
              certifyBar={
                <CertifyBar
                  projectId={projectId}
                  valuation={detail.valuation}
                  canEdit={canEdit}
                  certifiedByName={detail.certifiedByName}
                  onChanged={handleChanged}
                />
              }
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
