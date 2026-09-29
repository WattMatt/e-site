'use client'
/**
 * Ingest one stored source (spec §12). Workbooks: Dry run, then Apply (the
 * 2a core via /api/admin/tariffs/ingest; years land in review, never
 * published). PDFs: Queue ingest (the staff worker runs pdftotext).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IngestReportSummary } from '@esite/shared/tariffs/ingest'
import { INGEST_YEAR_ACTION_LABELS, labelOf } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { queueIngestJobAction } from '@/actions/tariff-library.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'

export interface IngestSource {
  id: string
  fileKind: 'pdf' | 'xlsx'
  financialYear: string
  licenseeName: string | null
}

export function IngestPanel({ source }: { source: IngestSource }) {
  const router = useRouter()
  const [parser, setParser] = useState(source.fileKind === 'pdf' ? 'rfd_pdf' : 'province_xlsx')
  const [fy, setFy] = useState(source.financialYear)
  const [licensee, setLicensee] = useState(source.licenseeName ?? '')
  const [createLicensees, setCreateLicensees] = useState(false)
  const [busy, setBusy] = useState<'dry' | 'apply' | 'queue' | null>(null)
  const [report, setReport] = useState<IngestReportSummary | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const applyConfirm = useArmedConfirm()
  const queueConfirm = useArmedConfirm()
  const replacing = report?.years.filter((y) => y.action === 'replace_draft').length ?? 0

  async function queue() {
    if (!licensee.trim()) { setMsg('An RfD covers one licensee: enter its name as the registry spells it.'); return }
    if (!queueConfirm.armed) { setMsg(null); queueConfirm.arm(); return }
    queueConfirm.disarm()
    setBusy('queue'); setMsg(null)
    const r = await queueIngestJobAction({ sourceDocumentId: source.id, parser: 'rfd_pdf', financialYear: fy, licenseeName: licensee, createLicensees })
    setBusy(null)
    if ('error' in r) setMsg(r.error); else { setMsg('Queued. The staff ingest worker will pick it up.'); router.refresh() }
  }

  function apply() {
    if (replacing > 0 && !applyConfirm.armed) { applyConfirm.arm(); return }
    applyConfirm.disarm()
    void run(true)
  }

  async function run(apply: boolean) {
    setBusy(apply ? 'apply' : 'dry'); setMsg(null)
    const res = await fetch('/api/admin/tariffs/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceDocumentId: source.id, parser, financialYear: fy, licenseeName: licensee, createLicensees, apply }),
    }).catch(() => null)
    setBusy(null)
    const json = res ? await res.json().catch(() => ({})) as { report?: IngestReportSummary; error?: string } : {}
    if (!res || !res.ok || !json.report) return setMsg(json.error ?? 'The ingest failed. Try again.')
    setReport(json.report)
    if (apply) { setMsg('Applied. The years are waiting for review under Tariff years.'); router.refresh() }
  }

  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <label>Parser <select value={parser} onChange={(e) => setParser(e.target.value)} disabled={source.fileKind === 'pdf'}>
          {source.fileKind === 'pdf'
            ? <option value="rfd_pdf">NERSA RfD (PDF)</option>
            : <><option value="province_xlsx">NERSA province compendium (XLSX)</option><option value="eskom_xlsm">Eskom schedule (XLSM)</option></>}
        </select></label>
        <label>Year <input value={fy} onChange={(e) => setFy(e.target.value)} style={{ width: 80 }} /></label>
        {parser === 'rfd_pdf' && <label>Licensee <input value={licensee} onChange={(e) => setLicensee(e.target.value)} /></label>}
        <label><input type="checkbox" checked={createLicensees} onChange={(e) => setCreateLicensees(e.target.checked)} /> Create unknown licensees</label>
        {source.fileKind === 'pdf'
          ? <Button size="sm" isLoading={busy === 'queue'} onClick={queue}>{queueConfirm.armed ? 'Confirm queue ingest' : 'Queue ingest'}</Button>
          : <>
              <Button size="sm" variant="secondary" isLoading={busy === 'dry'} onClick={() => run(false)}>Dry run</Button>
              {report?.status === 'dry_run' && (
                <Button size="sm" isLoading={busy === 'apply'} onClick={apply}>
                  {applyConfirm.armed ? `Replace ${replacing} draft year${replacing === 1 ? '' : 's'}?` : 'Apply (lands in review)'}
                </Button>
              )}
            </>}
      </div>
      {queueConfirm.armed && (
        <p role="status" style={{ fontSize: 13, margin: 0 }}>
          When the worker runs, it replaces any draft {fy} year {licensee.trim()} already has (a published year is never touched). Press again to queue.
        </p>
      )}
      {applyConfirm.armed && (
        <p role="status" style={{ fontSize: 13, margin: 0 }}>
          Applying replaces the draft years marked below; anything edited in them so far is lost. Press again to apply.
        </p>
      )}
      {msg && <p role="status" style={{ fontSize: 13, margin: 0 }}>{msg}</p>}
      {report && (
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['Licensee', 'Action', 'Tariffs', 'Charges', 'Blocking', 'Review', 'Unresolved', 'YoY'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '4px 8px' }}>{h}</th>)}</tr></thead>
          <tbody>{report.years.map((y, i) => (
            <tr key={i}>
              <td style={{ padding: '4px 8px' }}>{y.licensee}</td><td style={{ padding: '4px 8px' }}>{labelOf(INGEST_YEAR_ACTION_LABELS, y.action)}</td>
              <td style={{ padding: '4px 8px' }}>{y.tariffs}</td><td style={{ padding: '4px 8px' }}>{y.charges}</td>
              <td style={{ padding: '4px 8px' }}>{y.blocking}</td><td style={{ padding: '4px 8px' }}>{y.review}</td>
              <td style={{ padding: '4px 8px' }}>{y.unresolved}</td>
              <td style={{ padding: '4px 8px' }}>{y.yoy ? `+${y.yoy.added} −${y.yoy.removed} ~${y.yoy.changed} (${y.yoy.outOfBand} out of band)` : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
