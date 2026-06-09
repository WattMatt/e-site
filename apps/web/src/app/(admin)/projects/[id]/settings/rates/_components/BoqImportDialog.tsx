'use client'

/**
 * BoqImportDialog — the import flow modal.
 *
 *   1. Pick a .xlsx → POST /api/projects/[id]/boq/import (multipart, no persist).
 *   2. The route parses + reconciles and returns { parsed, report }.
 *   3. Render BoqReconciliationReport so the user sees totals-vs-expected.
 *   4. On Confirm → importBoqAction(projectId, parsed, fileName, null) persists,
 *      then router.refresh() so the server page re-fetches the new current import.
 *
 * Re-import is the same flow (persistImport demotes the prior current row).
 * Portal + fixed-overlay shell mirrors BoardManageModals' ModalShell.
 */

import { useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { importBoqAction } from '@/actions/boq.actions'
import type { ParsedBoq, ReconciliationReport } from '@/lib/boq/types'
import { BoqReconciliationReport } from './BoqReconciliationReport'

interface Props {
  projectId: string
  onClose: () => void
}

type Stage = 'pick' | 'parsing' | 'review'

export function BoqImportDialog({ projectId, onClose }: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('pick')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedBoq | null>(null)
  const [report, setReport] = useState<ReconciliationReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, startConfirm] = useTransition()

  async function handleFile(file: File) {
    setError(null)
    setFileName(file.name)
    setStage('parsing')
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`/api/projects/${projectId}/boq/import`, { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? `Import failed (${res.status})`)
        setStage('pick')
        return
      }
      setParsed(json.parsed as ParsedBoq)
      setReport(json.report as ReconciliationReport)
      setStage('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file')
      setStage('pick')
    }
  }

  function handleConfirm() {
    if (!parsed || !fileName) return
    setError(null)
    startConfirm(async () => {
      const res = await importBoqAction(projectId, parsed, fileName, null)
      if ('error' in res) {
        setError(res.error)
        return
      }
      onClose()
      router.refresh()
    })
  }

  const busy = stage === 'parsing' || confirming

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import BOQ"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          padding: 24,
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, color: 'var(--c-text)' }}>
          Import tender BOQ
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
          Upload the priced Bill of Quantities (.xlsx). We reconcile it against its own Main-Summary totals before saving.
        </p>

        {/* Hidden native input, driven by the button below */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = '' // allow re-selecting the same file
          }}
        />

        {stage === 'pick' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Button type="button" variant="primary" onClick={() => fileInputRef.current?.click()}>
              Choose .xlsx file
            </Button>
          </div>
        )}

        {stage === 'parsing' && (
          <p style={{ fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
            Parsing {fileName}…
          </p>
        )}

        {stage === 'review' && report && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
              {fileName}
            </div>
            <BoqReconciliationReport report={report} />
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {stage === 'review' && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              isLoading={confirming}
              disabled={confirming || !parsed}
              onClick={handleConfirm}
            >
              Confirm import
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
