'use client'

/**
 * VariationsTab — the Variations tab shell (client master-detail).
 *
 * Master: VariationsList (the VO sequence + New VO). Detail: the selected VO's
 * lines (VariationDetail) topped by the ApproveBar. The static BOQ tree
 * (sections/items, used by the line editor's pickers + live previews) comes
 * from the server page; the per-VO lines + live net change are fetched on
 * selection via getVariationOrderAction and re-fetched after every write so the
 * figures stay live.
 *
 * Prop contract (set by the server page):
 *   <VariationsTab projectId canEdit vos={…} sections={…} items={…} />
 */

import { useCallback, useEffect, useState } from 'react'
import type { BoqItem, BoqSection, VariationLine, VariationOrder } from '@esite/shared'
import { listVariationOrdersAction, getVariationOrderAction } from '@/actions/variation.actions'
import { VariationsList } from './VariationsList'
import { VariationDetail } from './VariationDetail'
import { ApproveBar } from './ApproveBar'

interface DetailState {
  vo: VariationOrder
  lines: VariationLine[]
  /** Live Σ value_change over the VO's lines (frozen as net_change on approve). */
  netChange: number
  approvedByName: string | null
}

interface Props {
  projectId: string
  canEdit: boolean
  vos: VariationOrder[]
  sections: BoqSection[]
  items: BoqItem[]
}

export function VariationsTab({ projectId, canEdit, vos: initialVos, sections, items }: Props) {
  const [vos, setVos] = useState<VariationOrder[]>(initialVos)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshList = useCallback(async () => {
    const res = await listVariationOrdersAction(projectId)
    if ('data' in res) setVos(res.data.vos)
  }, [projectId])

  const loadDetail = useCallback(
    async (voId: string) => {
      setLoadingDetail(true)
      setLoadError(null)
      const res = await getVariationOrderAction(projectId, voId)
      setLoadingDetail(false)
      if ('error' in res) {
        setLoadError(res.error)
        setDetail(null)
        return
      }
      setDetail({
        vo: res.data.vo,
        lines: res.data.lines,
        netChange: res.data.netChange,
        approvedByName: res.data.approvedByName,
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
  // list shows status + the frozen net change that approve sets).
  const handleChanged = useCallback(() => {
    if (selectedId) void loadDetail(selectedId)
    void refreshList()
  }, [selectedId, loadDetail, refreshList])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <VariationsList
        projectId={projectId}
        vos={vos}
        canEdit={canEdit}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreated={refreshList}
      />

      {selectedId && (
        <div>
          {loadingDetail && !detail ? (
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>Loading variation order…</p>
          ) : loadError ? (
            <p style={{ fontSize: 13, color: 'var(--c-red)' }}>{loadError}</p>
          ) : detail ? (
            <VariationDetail
              projectId={projectId}
              vo={detail.vo}
              lines={detail.lines}
              sections={sections}
              items={items}
              canEdit={canEdit}
              onChanged={handleChanged}
              approveBar={
                <ApproveBar
                  projectId={projectId}
                  vo={detail.vo}
                  netChange={detail.netChange}
                  canEdit={canEdit}
                  approvedByName={detail.approvedByName}
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
