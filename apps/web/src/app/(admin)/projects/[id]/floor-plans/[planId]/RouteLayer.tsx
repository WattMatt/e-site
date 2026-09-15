'use client'

import { Layer, Line, Circle, Group, Rect, Text as KonvaText } from 'react-konva'
import type Konva from 'konva'
import { polylineEdges, edgeLengthsM } from '@esite/shared'

/**
 * The ROUTE LAYER — how a cable run looks on a drawing.
 *
 * Its own Konva layer, beside the markup scene graph and never inside it. A
 * saved leg is drawn from the points stored in `cable_schedule.route_segments`;
 * the markup scene never holds route geometry, so totalling a run that crosses
 * sheets stays a query and recalibrating a sheet cannot silently move a length.
 *
 * Everything here is presentation. Lengths come from the shared maths so the
 * label beside an edge is the same number the server would compute for it.
 * Sizes are divided by `scale` so a label stays 12px on screen at any zoom.
 *
 * Style is FIXED. A measuring tool cannot borrow its look from whatever colour
 * the markup palette last had — on a power layout already dense with red and
 * blue, a thin dashed red line is invisible. Amber with a white halo is not.
 */

export const ROUTE_COLOUR = '#b45309'
const ROUTE_HALO = '#ffffff'
const SELECTED_COLOUR = '#1d4ed8'
const OTHER_COLOUR = '#6b7280'
const CALIB_COLOUR = '#0f766e'
const UNSAVED_COLOUR = '#c2410c'

export type RouteLayerLeg = {
  id: string
  floorPlanId: string | null
  pageIndex: number
  points: number[]
  lengthM: number
}

export type OtherLeg = { supplyId: string; label: string; pageIndex: number; points: number[]; lengthM?: number }

export type CalibrationLine = { points: number[]; metres: number; pageIndex: number }

type Props = {
  planId: string
  currentPage: number
  scale: number
  pixelsPerMeter: number | null
  /** This run's saved legs, in path order across every sheet. */
  legs: RouteLayerLeg[]
  /** Other runs' legs on this sheet. Faint beside an active run; full when the
   *  drawing is simply being viewed, so the sheet IS the record. */
  otherLegs: OtherLeg[]
  otherStyle?: 'faint' | 'full'
  /** Press a run drawn in full to start measuring it. Absent = not pressable. */
  onPressOther?: (supplyId: string) => void
  /** Finished but not yet saved. */
  pendingLeg: number[] | null
  /** Still being clicked out. */
  draftPoints: number[]
  selectedLegId: string | null
  /** Vertices are draggable only under the select tool. */
  editable: boolean
  calibration: CalibrationLine | null
  showCalibration: boolean
  onSelectLeg: (id: string | null) => void
  onMoveVertex: (legId: string, index: number, x: number, y: number) => void
  onInsertVertex: (legId: string, afterIndex: number, x: number, y: number) => void
  onRemoveVertex: (legId: string, index: number) => void
}

function fmt(m: number): string {
  return `${m.toFixed(2)} m`
}

/** A pill label that stays legible at any zoom. */
function Pill({ x, y, text, scale, colour, small }: { x: number; y: number; text: string; scale: number; colour: string; small?: boolean }) {
  const fs = (small ? 10 : 12) / scale
  const w = (text.length * (small ? 6.2 : 7.4) + 10) / scale
  const h = (small ? 15 : 18) / scale
  return (
    <Group x={x} y={y} listening={false}>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={ROUTE_HALO} opacity={0.94} cornerRadius={3 / scale} stroke={colour} strokeWidth={1 / scale} />
      <KonvaText
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        align="center"
        verticalAlign="middle"
        text={text}
        fontSize={fs}
        fontStyle="bold"
        fill={colour}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      />
    </Group>
  )
}

/**
 * A polyline with a white halo underneath so it reads on any linework.
 *
 * Selection fires on mousedown/touchstart, not click — the same choice every
 * markup shape in MarkupCanvas makes, because Konva's synthesised `click` does
 * not arrive reliably under automated input (see the pointer-handler note
 * there), and a control that only a human can operate cannot be tested.
 */
function HaloLine({
  points, colour, scale, dashed, listening, onPress,
}: { points: number[]; colour: string; scale: number; dashed?: boolean; listening?: boolean; onPress?: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void }) {
  return (
    <>
      <Line points={points} stroke={ROUTE_HALO} strokeWidth={8 / scale} lineCap="round" lineJoin="round" opacity={0.9} listening={false} />
      <Line
        points={points}
        stroke={colour}
        strokeWidth={3.5 / scale}
        lineCap="round"
        lineJoin="round"
        dash={dashed ? [10 / scale, 6 / scale] : undefined}
        hitStrokeWidth={16 / scale}
        listening={!!listening}
        onMouseDown={onPress}
        onTouchStart={onPress}
      />
    </>
  )
}

/** Per-edge metre labels along a polyline. */
function EdgeLabels({ points, ppm, scale, colour }: { points: number[]; ppm: number | null; scale: number; colour: string }) {
  if (!ppm || points.length < 4) return null
  const edges = polylineEdges(points)
  const metres = edgeLengthsM(points, ppm)
  return (
    <>
      {edges.map((e, i) => (
        <Pill key={i} x={e.midX} y={e.midY} text={fmt(metres[i])} scale={scale} colour={colour} />
      ))}
    </>
  )
}

export function RouteLayer({
  planId, currentPage, scale, pixelsPerMeter, legs = [], otherLegs = [], pendingLeg, draftPoints = [],
  selectedLegId, editable, calibration, showCalibration, otherStyle = 'faint', onPressOther,
  onSelectLeg, onMoveVertex, onInsertVertex, onRemoveVertex,
}: Props) {
  // A presentation layer must never take the viewer down. The arrays are
  // required by the type, but a stale payload or a caller that predates a
  // field should degrade to "nothing to draw", not to a blank drawing.

  const onSheet = (l: { floorPlanId?: string | null; pageIndex: number }) =>
    (l.floorPlanId === undefined || l.floorPlanId === planId) && l.pageIndex === currentPage

  return (
    <Layer>
      {/* The stored scale, so a calibrated sheet SHOWS where its scale came from. */}
      {showCalibration && calibration && calibration.pageIndex === currentPage && pixelsPerMeter && (
        <Group listening={false}>
          <Line points={calibration.points} stroke={ROUTE_HALO} strokeWidth={6 / scale} opacity={0.85} />
          <Line points={calibration.points} stroke={CALIB_COLOUR} strokeWidth={2 / scale} dash={[8 / scale, 5 / scale]} />
          <Circle x={calibration.points[0]} y={calibration.points[1]} radius={4 / scale} fill={CALIB_COLOUR} stroke={ROUTE_HALO} strokeWidth={1.5 / scale} />
          <Circle x={calibration.points[2]} y={calibration.points[3]} radius={4 / scale} fill={CALIB_COLOUR} stroke={ROUTE_HALO} strokeWidth={1.5 / scale} />
          <Pill
            x={(calibration.points[0] + calibration.points[2]) / 2}
            y={(calibration.points[1] + calibration.points[3]) / 2 - 14 / scale}
            text={`scale ${fmt(calibration.metres)} · ${pixelsPerMeter.toFixed(1)} px/m`}
            scale={scale}
            colour={CALIB_COLOUR}
            small
          />
        </Group>
      )}

      {/* Other runs on this sheet. */}
      {otherLegs.filter(onSheet).map((o, i) =>
        otherStyle === 'full' ? (
          <Group key={`other-${i}`}>
            <HaloLine
              points={o.points}
              colour={ROUTE_COLOUR}
              scale={scale}
              listening={!!onPressOther}
              onPress={(e) => { e.cancelBubble = true; onPressOther?.(o.supplyId) }}
            />
            <EdgeLabels points={o.points} ppm={pixelsPerMeter} scale={scale} colour={ROUTE_COLOUR} />
            <Pill x={o.points[0]} y={o.points[1] - 16 / scale} text={o.lengthM != null ? `${o.label} · ${fmt(o.lengthM)}` : o.label} scale={scale} colour={ROUTE_COLOUR} small />
          </Group>
        ) : (
          <Group key={`other-${i}`} listening={false}>
            <Line points={o.points} stroke={OTHER_COLOUR} strokeWidth={2 / scale} opacity={0.55} lineCap="round" lineJoin="round" />
            <Pill x={o.points[0]} y={o.points[1] - 12 / scale} text={o.label} scale={scale} colour={OTHER_COLOUR} small />
          </Group>
        ),
      )}

      {/* This run's saved legs. */}
      {legs.map((leg, legIndex) => {
        if (!onSheet(leg)) return null
        const selected = leg.id === selectedLegId
        const colour = selected ? SELECTED_COLOUR : ROUTE_COLOUR
        const pts = leg.points
        return (
          <Group key={leg.id}>
            <HaloLine
              points={pts}
              colour={colour}
              scale={scale}
              listening={editable}
              onPress={(e) => { e.cancelBubble = true; onSelectLeg(selected ? null : leg.id) }}
            />
            <EdgeLabels points={pts} ppm={pixelsPerMeter} scale={scale} colour={colour} />
            <Pill x={pts[0]} y={pts[1] - 16 / scale} text={`leg ${legIndex + 1} · ${fmt(leg.lengthM)}`} scale={scale} colour={colour} small />
            {selected && editable && (
              <>
                {polylineEdges(pts).map((e, i) => (
                  <Circle
                    key={`ins-${i}`}
                    x={e.midX}
                    y={e.midY}
                    // 8 screen px: a midpoint target a mouse can land on. At 5 it
                    // was missed from frame coordinates and would be fiddly by hand.
                    radius={8 / scale}
                    fill={ROUTE_HALO}
                    stroke={SELECTED_COLOUR}
                    strokeWidth={2 / scale}
                    onMouseDown={(ev) => { ev.cancelBubble = true; onInsertVertex(leg.id, i, e.midX, e.midY) }}
                    onTouchStart={(ev) => { ev.cancelBubble = true; onInsertVertex(leg.id, i, e.midX, e.midY) }}
                  />
                ))}
                {Array.from({ length: pts.length / 2 }).map((_, i) => (
                  <Circle
                    key={`vtx-${i}`}
                    x={pts[i * 2]}
                    y={pts[i * 2 + 1]}
                    radius={9 / scale}
                    fill={SELECTED_COLOUR}
                    stroke={ROUTE_HALO}
                    strokeWidth={2 / scale}
                    draggable
                    onMouseDown={(ev) => { ev.cancelBubble = true }}
                    onDragEnd={(ev) => onMoveVertex(leg.id, i, ev.target.x(), ev.target.y())}
                    onContextMenu={(ev) => { ev.evt.preventDefault(); ev.cancelBubble = true; onRemoveVertex(leg.id, i) }}
                  />
                ))}
              </>
            )}
          </Group>
        )
      })}

      {/* Finished, unsaved. */}
      {pendingLeg && pendingLeg.length >= 4 && (
        <Group listening={false}>
          <HaloLine points={pendingLeg} colour={UNSAVED_COLOUR} scale={scale} />
          <EdgeLabels points={pendingLeg} ppm={pixelsPerMeter} scale={scale} colour={UNSAVED_COLOUR} />
          {Array.from({ length: pendingLeg.length / 2 }).map((_, i) => (
            <Circle key={`pend-${i}`} x={pendingLeg[i * 2]} y={pendingLeg[i * 2 + 1]} radius={4.5 / scale} fill={UNSAVED_COLOUR} stroke={ROUTE_HALO} strokeWidth={1.5 / scale} />
          ))}
          <Pill x={pendingLeg[0]} y={pendingLeg[1] - 16 / scale} text="unsaved leg" scale={scale} colour={UNSAVED_COLOUR} small />
        </Group>
      )}

      {/* Being clicked out right now. */}
      {draftPoints.length >= 2 && (
        <Group listening={false}>
          {draftPoints.length >= 4 && <HaloLine points={draftPoints} colour={ROUTE_COLOUR} scale={scale} dashed />}
          <EdgeLabels points={draftPoints} ppm={pixelsPerMeter} scale={scale} colour={ROUTE_COLOUR} />
          {Array.from({ length: draftPoints.length / 2 }).map((_, i) => (
            <Circle key={`draft-${i}`} x={draftPoints[i * 2]} y={draftPoints[i * 2 + 1]} radius={4.5 / scale} fill={ROUTE_COLOUR} stroke={ROUTE_HALO} strokeWidth={1.5 / scale} />
          ))}
        </Group>
      )}
    </Layer>
  )
}
