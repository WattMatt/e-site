'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { polylineLengthPx, segmentLengthM, derivePixelsPerMeter } from '@esite/shared'
import { calibrateFloorPlanAction } from '@/actions/cable-route.actions'
import type { PlanRow } from './RouteMeasureWorkspace'

/** One traced leg of a run, on one sheet. Metres shown here are advisory; the
 *  server recomputes them from the drawing's calibration when saving. */
export interface TracedSegment {
  floorPlanId: string
  floorPlanName: string
  pageIndex: number
  points: number[]
  pixelsPerMeter: number
  lengthM: number
}

/**
 * PDF pages are rasterised at scale 2, deliberately and not arbitrarily.
 *
 * The existing markup canvas renders at `getViewport({ scale: 2 })`, and a
 * drawing's `pixels_per_meter` is derived in whatever space the calibration was
 * drawn in. Rendering here at a different scale would make a drawing calibrated
 * in one tool measure wrongly in the other, with no error and no clue — the
 * lengths would simply be out by the scale ratio. The two surfaces must agree.
 */
const PDF_RENDER_SCALE = 2

type Mode = 'trace' | 'calibrate'

/** One line of the condensed schedule printed onto an exported sheet. */
export interface SheetLegendRow {
  label: string
  totalM: number
  /** Metres of this run that were traced on the sheet being exported. */
  onSheetM: number
  /** True when part of the route lives on another sheet. */
  continuesElsewhere: boolean
}

export function RouteCanvas({
  projectId,
  plans,
  segments,
  onSegmentsChange,
  runLabel,
  legendFor,
}: {
  projectId: string
  plans: PlanRow[]
  segments: TracedSegment[]
  onSegmentsChange: (next: TracedSegment[]) => void
  runLabel: string
  /** Saved routes with a leg on the given sheet, for the exported legend. */
  legendFor: (planId: string, pageIndex: number) => SheetLegendRow[]
}) {
  const [planId, setPlanId] = useState<string>(plans[0]?.id ?? '')
  const [pageIndex, setPageIndex] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [mode, setMode] = useState<Mode>('trace')
  const [draft, setDraft] = useState<number[]>([])
  const [calibPts, setCalibPts] = useState<number[]>([])
  const [ppmOverride, setPpmOverride] = useState<Record<string, number>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  const plan = plans.find((p) => p.id === planId) ?? null
  const ppm = plan ? ppmOverride[plan.id] ?? plan.pixelsPerMeter : null
  const calibrated = !!(ppm && ppm > 0)

  // ── Load the drawing into a backing canvas ────────────────────────────────
  useEffect(() => {
    if (!plan) return
    let cancelled = false
    setLoadError(null)
    setNatural(null)
    ;(async () => {
      try {
        const supabase = createClient()
        const { data, error } = await supabase.storage
          .from('drawings')
          .createSignedUrl(plan.filePath, 3600)
        if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not open drawing')
        if (cancelled) return

        const target = canvasRef.current
        if (!target) return

        if (plan.isPdf) {
          const pdfjsLib = await import('pdfjs-dist')
          if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
          }
          const pdf = await pdfjsLib.getDocument(data.signedUrl).promise
          if (cancelled) return
          setPageCount(pdf.numPages)
          const page = await pdf.getPage(Math.min(pageIndex, pdf.numPages))
          if (cancelled) return
          const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
          target.width = Math.floor(viewport.width)
          target.height = Math.floor(viewport.height)
          const ctx = target.getContext('2d')
          if (!ctx) throw new Error('2d context unavailable')
          await page.render({ canvasContext: ctx, viewport, canvas: target } as any).promise
          if (cancelled) return
          setNatural({ w: target.width, h: target.height })
        } else {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          await new Promise<void>((res, rej) => {
            img.onload = () => res()
            img.onerror = () => rej(new Error('Could not load image'))
            img.src = data.signedUrl
          })
          if (cancelled) return
          setPageCount(1)
          target.width = img.naturalWidth
          target.height = img.naturalHeight
          target.getContext('2d')?.drawImage(img, 0, 0)
          setNatural({ w: target.width, h: target.height })
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not open drawing')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [plan, pageIndex])

  // ── Click → backing-canvas coordinates ────────────────────────────────────
  const toBacking = useCallback(
    (e: React.MouseEvent): [number, number] | null => {
      const host = hostRef.current
      const c = canvasRef.current
      if (!host || !c || !natural) return null
      const rect = c.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const x = ((e.clientX - rect.left) / rect.width) * natural.w
      const y = ((e.clientY - rect.top) / rect.height) * natural.h
      return [x, y]
    },
    [natural],
  )

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const pt = toBacking(e)
      if (!pt) return
      if (mode === 'calibrate') {
        setCalibPts((prev) => (prev.length >= 4 ? [pt[0], pt[1]] : [...prev, pt[0], pt[1]]))
        return
      }
      setDraft((prev) => [...prev, pt[0], pt[1]])
    },
    [mode, toBacking],
  )

  const draftLengthM = useMemo(() => {
    if (draft.length < 4 || !calibrated) return null
    try {
      return segmentLengthM(draft, ppm!)
    } catch {
      return null
    }
  }, [draft, calibrated, ppm])

  const commitSegment = useCallback(() => {
    if (!plan || draft.length < 4 || !calibrated) return
    onSegmentsChange([
      ...segments,
      {
        floorPlanId: plan.id,
        floorPlanName: plan.name,
        pageIndex,
        points: draft,
        pixelsPerMeter: ppm!,
        lengthM: segmentLengthM(draft, ppm!),
      },
    ])
    setDraft([])
  }, [plan, draft, calibrated, ppm, segments, onSegmentsChange, pageIndex])

  const saveCalibration = useCallback(
    async (metres: number) => {
      if (!plan || calibPts.length < 4) return
      setBusy(true)
      try {
        const res = await calibrateFloorPlanAction({
          floorPlanId: plan.id,
          points: calibPts.slice(0, 4),
          realMetres: metres,
        })
        if (res.error) {
          setLoadError(res.error)
          return
        }
        // Keep the derived value locally too, so the very next trace works
        // without a page refresh.
        const local = derivePixelsPerMeter(calibPts.slice(0, 4), metres)
        setPpmOverride((prev) => ({ ...prev, [plan.id]: res.pixelsPerMeter ?? local }))
        setCalibPts([])
        setMode('trace')
      } finally {
        setBusy(false)
      }
    },
    [plan, calibPts],
  )

  /**
   * Export the sheet as it stands: the drawing, the routes traced on it, and a
   * condensed schedule of those runs.
   *
   * Everything — including the legend text — is drawn into a CANVAS and the
   * resulting raster is what becomes the PDF page. No text is handed to
   * pdf-lib, and that is deliberate: pdf-lib's standard fonts are WinAnsi-only
   * and throw on the first Ω, ≤ or → in a board name, which is exactly how the
   * cable-schedule PDF export was broken from the day it shipped until PR #154.
   * A board code is user-entered text. Rasterising the legend means no glyph
   * can ever reach a font encoder.
   */
  const exportSheet = useCallback(async () => {
    const src = canvasRef.current
    if (!src || !plan || !natural) return
    setBusy(true)
    try {
      const rows = legendFor(plan.id, pageIndex)
      const pad = 24
      const lineH = 34
      const headH = 64
      const legendH = rows.length > 0 ? headH + rows.length * lineH + pad : 0
      const out = document.createElement('canvas')
      out.width = natural.w
      out.height = natural.h + legendH
      const ctx = out.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(src, 0, 0)

      // Routes traced on this sheet.
      ctx.lineWidth = Math.max(3, natural.w / 500)
      ctx.strokeStyle = '#0F8A5F'
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      for (const s of segments.filter((g) => g.floorPlanId === plan.id && g.pageIndex === pageIndex)) {
        ctx.beginPath()
        for (let i = 0; i + 1 < s.points.length; i += 2) {
          if (i === 0) ctx.moveTo(s.points[0], s.points[1])
          else ctx.lineTo(s.points[i], s.points[i + 1])
        }
        ctx.stroke()
      }

      // The condensed schedule.
      if (rows.length > 0) {
        const top = natural.h
        ctx.fillStyle = '#F4F4F2'
        ctx.fillRect(0, top, out.width, legendH)
        ctx.strokeStyle = '#B9B5AE'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(out.width, top); ctx.stroke()

        ctx.fillStyle = '#111111'
        ctx.font = `700 ${Math.round(lineH * 0.62)}px system-ui, sans-serif`
        ctx.fillText('CABLE RUNS ON THIS SHEET', pad, top + headH * 0.62)

        ctx.font = `${Math.round(lineH * 0.56)}px system-ui, sans-serif`
        rows.forEach((r, i) => {
          const y = top + headH + i * lineH + lineH * 0.7
          ctx.fillStyle = '#111111'
          ctx.fillText(r.label, pad, y)
          const note = r.continuesElsewhere
            ? `${r.onSheetM.toFixed(2)} m on sheet  ·  ${r.totalM.toFixed(2)} m total (route continues on another sheet)`
            : `${r.totalM.toFixed(2)} m total`
          ctx.fillStyle = r.continuesElsewhere ? '#8A5A00' : '#333333'
          ctx.fillText(note, Math.round(out.width * 0.42), y)
        })
      }

      const blob: Blob | null = await new Promise((res) => out.toBlob(res, 'image/png'))
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${plan.name.replace(/\.[^.]+$/, '')} — cable runs.png`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }, [plan, natural, segments, pageIndex, legendFor])

  const displayScale = natural && hostRef.current
    ? Math.min(1, (hostRef.current.clientWidth || 900) / natural.w)
    : 1

  const svgPoints = (pts: number[]) =>
    pts.reduce<string[]>((acc, v, i) => {
      if (i % 2 === 0) acc.push(`${v * displayScale}`)
      else acc[acc.length - 1] += `,${v * displayScale}`
      return acc
    }, []).join(' ')

  const onThisSheet = segments.filter((s) => s.floorPlanId === planId && s.pageIndex === pageIndex)

  return (
    <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 10 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, borderBottom: '1px solid var(--c-border)', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>{runLabel}</strong>

        <select
          value={planId}
          onChange={(e) => { setPlanId(e.target.value); setPageIndex(1); setDraft([]); setCalibPts([]) }}
          style={selectStyle}
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.pixelsPerMeter ? '' : '  (not calibrated)'}
            </option>
          ))}
        </select>

        {pageCount > 1 && (
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            <button type="button" onClick={() => setPageIndex((p) => Math.max(1, p - 1))} style={miniBtn}>‹</button>
            page {pageIndex} / {pageCount}
            <button type="button" onClick={() => setPageIndex((p) => Math.min(pageCount, p + 1))} style={miniBtn}>›</button>
          </span>
        )}

        {!calibrated && (
          <span style={{ fontSize: 12, color: 'var(--c-amber)' }}>
            This drawing has no scale yet — calibrate it once and every run on it can be measured.
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => { setMode(mode === 'calibrate' ? 'trace' : 'calibrate'); setCalibPts([]); setDraft([]) }}
            style={toolBtn(mode === 'calibrate')}
          >
            {calibrated ? 'Recalibrate' : 'Calibrate'}
          </button>
          <button type="button" onClick={() => setDraft((d) => d.slice(0, -2))} disabled={draft.length === 0} style={toolBtn(false)}>
            Undo point
          </button>
          <button type="button" onClick={commitSegment} disabled={draft.length < 4 || !calibrated} style={toolBtn(false)}>
            Add leg{draftLengthM != null ? ` (${draftLengthM.toFixed(2)} m)` : ''}
          </button>
          <button
            type="button"
            onClick={exportSheet}
            disabled={busy || !natural}
            style={toolBtn(false)}
            title="Save this sheet with its routes and a condensed schedule of the runs on it"
          >
            Export sheet
          </button>
        </div>
      </div>

      {mode === 'calibrate' && (
        <CalibrationBar
          points={calibPts}
          busy={busy}
          onCancel={() => { setCalibPts([]); setMode('trace') }}
          onSave={saveCalibration}
        />
      )}

      {/* Drawing */}
      <div ref={hostRef} style={{ position: 'relative', overflow: 'auto', maxHeight: '62vh', padding: 8 }}>
        {loadError && <p style={{ color: 'var(--c-red, #F87171)', fontSize: 13, padding: 12 }}>{loadError}</p>}
        <div style={{ position: 'relative', display: 'inline-block', cursor: 'crosshair' }} onClick={onClick}>
          <canvas
            ref={canvasRef}
            style={{ display: 'block', width: natural ? natural.w * displayScale : '100%', height: 'auto' }}
          />
          {natural && (
            <svg
              width={natural.w * displayScale}
              height={natural.h * displayScale}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              {onThisSheet.map((s, i) => (
                <polyline key={i} points={svgPoints(s.points)} fill="none" stroke="#34D399" strokeWidth={3} />
              ))}
              {draft.length >= 4 && (
                <polyline points={svgPoints(draft)} fill="none" stroke="#E8923A" strokeWidth={3} />
              )}
              {mode === 'calibrate' && calibPts.length >= 4 && (
                <polyline points={svgPoints(calibPts.slice(0, 4))} fill="none" stroke="#60A5FA" strokeWidth={3} />
              )}
              {chunk2(draft).map(([x, y], i) => (
                <circle key={`d${i}`} cx={x * displayScale} cy={y * displayScale} r={4} fill="#E8923A" />
              ))}
            </svg>
          )}
        </div>
      </div>

      {/* Legs so far — the condensed view of this run */}
      {segments.length > 0 && (
        <div style={{ borderTop: '1px solid var(--c-border)', padding: 10 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-text-dim)', marginBottom: 6 }}>
            Route legs
          </div>
          {segments.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
              <span style={{ color: 'var(--c-text-dim)' }}>{i + 1}.</span>
              <span style={{ flex: 1 }}>
                {s.floorPlanName}{s.pageIndex > 1 ? ` p${s.pageIndex}` : ''}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.lengthM.toFixed(2)} m</span>
              <button
                type="button"
                onClick={() => onSegmentsChange(segments.filter((_, j) => j !== i))}
                style={{ ...miniBtn, color: 'var(--c-text-dim)' }}
                aria-label={`Remove leg ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CalibrationBar({
  points,
  busy,
  onCancel,
  onSave,
}: {
  points: number[]
  busy: boolean
  onCancel: () => void
  onSave: (metres: number) => void
}) {
  const [metres, setMetres] = useState('')
  const px = points.length >= 4 ? polylineLengthPx(points.slice(0, 4)) : 0
  return (
    <div style={{ padding: 10, borderBottom: '1px solid var(--c-border)', background: 'color-mix(in srgb, #60A5FA 10%, transparent)', fontSize: 13 }}>
      Click two points across something you know the length of, then type that length.
      {px > 0 && <span style={{ color: 'var(--c-text-dim)' }}> {` (${px.toFixed(0)} px picked)`}</span>}
      <span style={{ marginLeft: 10 }}>
        <input
          type="number"
          min={0}
          step={0.1}
          placeholder="metres"
          value={metres}
          onChange={(e) => setMetres(e.target.value)}
          style={{ width: 90, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-bg)', color: 'var(--c-text)' }}
        />
        <button
          type="button"
          disabled={busy || px <= 0 || !(Number(metres) > 0)}
          onClick={() => onSave(Number(metres))}
          style={{ ...miniBtn, marginLeft: 6 }}
        >
          Save scale
        </button>
        <button type="button" onClick={onCancel} style={miniBtn}>Cancel</button>
      </span>
    </div>
  )
}

function chunk2(flat: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]])
  return out
}

const selectStyle: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'var(--c-bg)',
  color: 'var(--c-text)',
  fontSize: 12,
  maxWidth: 320,
}

const miniBtn: React.CSSProperties = {
  padding: '3px 8px',
  margin: '0 2px',
  borderRadius: 5,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-text)',
  fontSize: 12,
  cursor: 'pointer',
}

function toolBtn(active: boolean): React.CSSProperties {
  return {
    padding: '5px 10px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    border: '1px solid ' + (active ? 'var(--c-amber)' : 'var(--c-border)'),
    background: active ? 'var(--c-amber)' : 'transparent',
    color: active ? '#0D0B09' : 'var(--c-text)',
  }
}
