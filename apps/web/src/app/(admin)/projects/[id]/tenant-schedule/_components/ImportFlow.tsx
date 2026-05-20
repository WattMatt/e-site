'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type {
  ImportPreview,
  ImportNew,
  ImportUpdated,
  ImportDecommissioned,
} from '@esite/shared'
import type { CommitResult } from '@/app/api/tenant-schedule/commit/route'

interface Props {
  projectId: string
}

type Stage = 'idle' | 'parsing' | 'preview' | 'committing' | 'done' | 'error'

export function ImportFlow({ projectId }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [isPending, startTransition] = useTransition()

  function reset() {
    setStage('idle')
    setPreview(null)
    setCommitResult(null)
    setErrorMsg(null)
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setStage('parsing')
    setErrorMsg(null)
    setPreview(null)

    try {
      const body = new FormData()
      body.append('file', f)
      body.append('projectId', projectId)

      const res = await fetch('/api/tenant-schedule/parse', { method: 'POST', body })
      const json = await res.json()

      if (!res.ok) {
        setStage('error')
        setErrorMsg(json.error ?? `Parse failed (HTTP ${res.status})`)
        return
      }

      setPreview(json as ImportPreview)
      setStage('preview')
    } catch (err: unknown) {
      setStage('error')
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected error during parse')
    }
  }

  async function handleCommit() {
    if (!file) return
    setStage('committing')
    setErrorMsg(null)

    try {
      const body = new FormData()
      body.append('file', file)
      body.append('projectId', projectId)

      const res = await fetch('/api/tenant-schedule/commit', { method: 'POST', body })
      const json = await res.json()

      if (res.status >= 400) {
        setStage('error')
        setErrorMsg(json.error ?? `Commit failed (HTTP ${res.status})`)
        return
      }

      // HTTP 200 (all ok) or HTTP 207 (partial — some write_errors)
      setCommitResult(json as CommitResult)
      setStage('done')

      // Refresh the page table to show the synced data
      startTransition(() => { router.refresh() })
    } catch (err: unknown) {
      setStage('error')
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected error during commit')
    }
  }

  // ── Trigger the file picker ──────────────────────────────────────────────
  if (stage === 'idle') {
    return (
      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <Button onClick={() => fileRef.current?.click()}>
          ⬆ Import tenant schedule (.xlsx)
        </Button>
      </div>
    )
  }

  // ── Parsing spinner ──────────────────────────────────────────────────────
  if (stage === 'parsing') {
    return (
      <Button variant="secondary" isLoading disabled>
        Parsing {file?.name ?? 'file'}…
      </Button>
    )
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (stage === 'error') {
    return (
      <div style={{ border: '1px solid var(--c-red)', borderRadius: 8, background: 'var(--c-panel)' }}>
        <CardBody>
          <p style={{ color: 'var(--c-red)', fontWeight: 600, marginBottom: 8 }}>Import failed</p>
          <p style={{ fontSize: 13, color: 'var(--c-text-mid)', marginBottom: 12 }}>{errorMsg}</p>
          <Button variant="danger" onClick={reset}>Try again</Button>
        </CardBody>
      </div>
    )
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  if (stage === 'done' && commitResult) {
    const hasWriteErrors = commitResult.write_errors.length > 0
    const hasSkipped = commitResult.skipped_parse_errors > 0
    const hasWarnings = hasWriteErrors || hasSkipped
    return (
      <div style={{ border: hasWarnings ? '1px solid var(--c-amber-mid)' : '1px solid var(--c-green)', borderRadius: 8, background: 'var(--c-panel)' }}>
        <CardBody>
          <p style={{ fontWeight: 600, marginBottom: 8, color: hasWarnings ? 'var(--c-amber)' : 'var(--c-text)' }}>
            {hasWarnings ? 'Import completed with warnings' : 'Import complete'}
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: hasWarnings ? 12 : 0 }}>
            {commitResult.created > 0 && (
              <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
                <strong style={{ color: 'var(--c-text)' }}>{commitResult.created}</strong> added
              </span>
            )}
            {commitResult.updated > 0 && (
              <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
                <strong style={{ color: 'var(--c-text)' }}>{commitResult.updated}</strong> updated
              </span>
            )}
            {commitResult.decommissioned > 0 && (
              <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
                <strong style={{ color: 'var(--c-text)' }}>{commitResult.decommissioned}</strong> decommissioned
              </span>
            )}
          </div>
          {hasSkipped && (
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--c-amber-dim)', borderRadius: 4 }}>
              <p style={{ fontSize: 12, color: 'var(--c-amber)' }}>
                {commitResult.skipped_parse_errors} row{commitResult.skipped_parse_errors !== 1 ? 's' : ''} skipped — had parse errors, not committed.
              </p>
            </div>
          )}
          {hasWriteErrors && (
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--c-amber-dim)', borderRadius: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-amber)', marginBottom: 6 }}>
                {commitResult.write_errors.length} write error{commitResult.write_errors.length !== 1 ? 's' : ''}
              </p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {commitResult.write_errors.map((e, i) => (
                  <li key={i} style={{ fontSize: 12, color: 'var(--c-text-mid)', marginBottom: 2 }}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Button variant="secondary" onClick={reset}>
              Import again
            </Button>
          </div>
        </CardBody>
      </div>
    )
  }

  // ── Committing spinner ───────────────────────────────────────────────────
  if (stage === 'committing') {
    return (
      <Button isLoading disabled>
        Committing changes…
      </Button>
    )
  }

  // ── Preview ──────────────────────────────────────────────────────────────
  if (stage === 'preview' && preview) {
    const newCount = preview.new_entries.length
    const updatedCount = preview.updated_entries.length
    const decomCount = preview.decommissioned_entries.length
    const errorCount = preview.parse_errors.length

    return (
      <Card>
        <CardBody>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            <div>
              <p style={{ fontWeight: 600, marginBottom: 2 }}>
                Import preview — {preview.parsed_row_count} row{preview.parsed_row_count !== 1 ? 's' : ''} parsed
              </p>
              <p style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
                {file?.name}
              </p>
            </div>
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>

          {/* Summary badges */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <Badge variant="success">{newCount} new</Badge>
            <Badge variant="info">{updatedCount} updated</Badge>
            <Badge variant={decomCount > 0 ? 'danger' : 'ghost'}>{decomCount} decommissioned</Badge>
            {errorCount > 0 && <Badge variant="warning">{errorCount} parse error{errorCount !== 1 ? 's' : ''}</Badge>}
          </div>

          {/* ── DECOMMISSIONED — prominent warning block ─────────────────── */}
          {decomCount > 0 && (
            <div style={{
              padding: '12px 14px',
              marginBottom: 16,
              background: 'var(--c-red-dim)',
              border: '1.5px solid var(--c-red)',
              borderRadius: 6,
            }}>
              <p style={{ fontWeight: 700, color: 'var(--c-red)', marginBottom: 6, fontSize: 14 }}>
                ⚠ {decomCount} shop{decomCount !== 1 ? 's' : ''} will be DECOMMISSIONED
              </p>
              <p style={{ fontSize: 12, color: 'var(--c-text-mid)', marginBottom: 10 }}>
                These shops are in the database but absent from the uploaded file. They will be marked
                decommissioned — not deleted. Their cable feeds, inspections, and orders are preserved.
                Verify this is intentional before confirming.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(preview.decommissioned_entries as ImportDecommissioned[]).map((e) => (
                  <div
                    key={e.existing.id}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '5px 8px',
                      background: 'var(--c-red-dim)',
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-red)', minWidth: 80 }}>
                      {e.existing.shop_number}
                    </span>
                    <span style={{ color: 'var(--c-text)' }}>{e.existing.shop_name ?? e.existing.name ?? '—'}</span>
                    {e.existing.shop_area_m2 != null && (
                      <span style={{ color: 'var(--c-text-dim)', marginLeft: 'auto' }}>
                        {e.existing.shop_area_m2} m²
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Parse errors ─────────────────────────────────────────────── */}
          {errorCount > 0 && (
            <div style={{
              padding: '10px 14px',
              marginBottom: 16,
              background: 'var(--c-amber-dim)',
              border: '1px solid var(--c-amber-mid)',
              borderRadius: 6,
            }}>
              <p style={{ fontWeight: 600, color: 'var(--c-amber)', marginBottom: 6, fontSize: 13 }}>
                {errorCount} parse error{errorCount !== 1 ? 's' : ''} — fix these rows before committing
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {preview.parse_errors.map((err, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-amber)' }}>
                      Row {err.source_row}:
                    </span>{' '}
                    {err.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── New shops ────────────────────────────────────────────────── */}
          {newCount > 0 && (
            <PreviewGroup title={`${newCount} new shop${newCount !== 1 ? 's' : ''}`} color="var(--c-text)">
              {(preview.new_entries as ImportNew[]).map((e, i) => (
                <PreviewRow key={i}
                  shopNum={e.row.shop_number}
                  name={e.row.shop_name}
                  area={e.row.shop_area_m2}
                  extra={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>{e.derived_code}</span>}
                />
              ))}
            </PreviewGroup>
          )}

          {/* ── Updated shops ────────────────────────────────────────────── */}
          {updatedCount > 0 && (
            <PreviewGroup title={`${updatedCount} updated shop${updatedCount !== 1 ? 's' : ''}`} color="var(--c-text)">
              {(preview.updated_entries as ImportUpdated[]).map((e, i) => {
                const hasChanges = Object.keys(e.changes).length > 0
                return (
                  <PreviewRow key={i}
                    shopNum={e.row.shop_number}
                    name={e.row.shop_name}
                    area={e.row.shop_area_m2}
                    extra={
                      hasChanges ? (
                        <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                          {Object.entries(e.changes).map(([k, v]) => {
                            const change = v as { from: unknown; to: unknown }
                            return `${k}: ${change.from ?? '—'} → ${change.to ?? '—'}`
                          }).join(', ')}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>no field changes</span>
                      )
                    }
                  />
                )
              })}
            </PreviewGroup>
          )}

          {/* ── Confirm button ───────────────────────────────────────────── */}
          <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
            <Button onClick={handleCommit} disabled={isPending}>
              {isPending ? 'Committing…' : `Confirm import`}
            </Button>
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
              {newCount + updatedCount + decomCount} change{newCount + updatedCount + decomCount !== 1 ? 's' : ''} will be applied
            </span>
          </div>
        </CardBody>
      </Card>
    )
  }

  return null
}

// ── Small helpers ────────────────────────────────────────────────────────────

function PreviewGroup({
  title,
  color,
  children,
}: {
  title: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </div>
    </div>
  )
}

function PreviewRow({
  shopNum,
  name,
  area,
  extra,
}: {
  shopNum: string | null
  name: string | null
  area: number | null
  extra?: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      padding: '4px 8px',
      background: 'var(--c-panel)',
      borderRadius: 4,
      fontSize: 13,
      flexWrap: 'wrap',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-text-dim)', minWidth: 80 }}>
        {shopNum ?? '—'}
      </span>
      <span style={{ color: 'var(--c-text)', flex: 1 }}>{name ?? '—'}</span>
      {area != null && (
        <span style={{ color: 'var(--c-text-dim)' }}>{area} m²</span>
      )}
      {extra && <span>{extra}</span>}
    </div>
  )
}
