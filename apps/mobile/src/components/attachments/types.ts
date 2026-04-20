// Mobile mirror of apps/web/src/components/attachments/types.ts.
// Scene graph is identical — web and mobile round-trip the same JSONB payload.
export type AttachmentEntityType =
  | 'rfi'
  | 'rfi_response'
  | 'snag'
  | 'site_diary_entry'
  | 'procurement_item'
  | 'handover'

export interface AnnotationData {
  version: 1
  canvas: { width: number; height: number }
  baseImage: { naturalWidth: number; naturalHeight: number; signedUrl?: string }
  shapes: AnnotationShape[]
}

export type AnnotationColor = '#ef4444' | '#f59e0b' | '#22c55e' | '#3b82f6' | '#ffffff' | '#000000'

export type AnnotationShape =
  | PenShape
  | ArrowShape
  | RectShape
  | CircleShape
  | TextShape
  | PinShape

interface ShapeBase { id: string; color: AnnotationColor }
export interface PenShape    extends ShapeBase { type: 'pen';    points: number[]; strokeWidth: number }
export interface ArrowShape  extends ShapeBase { type: 'arrow';  points: [number, number, number, number]; strokeWidth: number }
export interface RectShape   extends ShapeBase { type: 'rect';   x: number; y: number; width: number; height: number; strokeWidth: number }
export interface CircleShape extends ShapeBase { type: 'circle'; x: number; y: number; radius: number; strokeWidth: number }
export interface TextShape   extends ShapeBase { type: 'text';   x: number; y: number; text: string; fontSize: number }
export interface PinShape    extends ShapeBase { type: 'pin';    x: number; y: number; label?: string }

export type AnnotationTool = 'pen' | 'arrow' | 'rect' | 'circle' | 'text' | 'pin'

// Mobile staged attachments — photos are uris, annotations are local file paths
// pointing to the composited Skia PNG snapshot.
export type StagedAttachment =
  | { kind: 'file'; id: string; uri: string; mimeType: string; fileName: string }
  | {
      kind: 'annotation'
      id: string
      uri: string              // local file URI for the composited PNG
      mimeType: 'image/png'
      fileName: string
      sourceFloorPlanId: string | null
      annotationData: AnnotationData
    }

export interface PersistedAttachment {
  id: string
  file_path: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  caption: string | null
  sort_order: number
  created_at: string
  signedUrl?: string | null
  annotation?: {
    id: string
    source_floor_plan_id: string | null
    annotation_data: AnnotationData
  }
}
