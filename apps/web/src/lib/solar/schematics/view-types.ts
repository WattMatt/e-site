// apps/web/src/lib/solar/schematics/view-types.ts
import type { SchematicDoc } from './editor'

export interface DrawingOption { id: string; name: string; isPdf: boolean }
export interface SchematicRowView {
  id: string
  name: string
  description: string | null
  kind: 'drawing' | 'blank'
  drawingName: string | null
  pageIndex: number
  placed: number
  updatedAt: string
}
export interface SchematicsListView {
  studyId: string | null
  studyUpdatedAt: string | null
  waived: boolean
  studyMeterCount: number
  schematics: SchematicRowView[]
  drawings: DrawingOption[]
}
export interface EditorMeter {
  id: string
  label: string
  kind: string
  tenantLabel: string | null
  nodeId: string | null
  /** true = in load, false = excluded, null = not linked to a tenant / not assigned. */
  included: boolean | null
}
export interface EditorView {
  schematic: { id: string; name: string; description: string | null; kind: 'drawing' | 'blank'; pageIndex: number; updatedAt: string; canvasW: number; canvasH: number; anchorChanged: boolean; floorPlanId: string | null }
  sheet: { planId: string; name: string; signedUrl: string | null; isPdf: boolean; widthPx: number | null; heightPx: number | null } | null
  doc: SchematicDoc
  meters: EditorMeter[]
  externalLines: Array<{ fromMeterId: string; toMeterId: string; lineType: 'supply' | 'check' }>
  drawings: DrawingOption[]
}
