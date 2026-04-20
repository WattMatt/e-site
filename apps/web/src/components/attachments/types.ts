// Shared types for the RFI / snag / diary attachment system.

export type AttachmentEntityType =
  | 'rfi'
  | 'rfi_response'
  | 'snag'
  | 'site_diary_entry'
  | 'procurement_item'
  | 'handover'

// ─── Annotation scene graph (version 1) ──────────────────────────────────────
// Stored in public.rfi_annotations.annotation_data as JSONB. Used by both the
// web (react-konva) and mobile (react-native-skia) annotators.
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

export type AnnotationTool = 'select' | 'pen' | 'arrow' | 'rect' | 'circle' | 'text' | 'pin'

// ─── Staged attachments (pre-commit, in-memory) ──────────────────────────────
export type StagedAttachment =
  | { kind: 'file'; id: string; file: File; previewUrl: string }
  | {
      kind: 'annotation'
      id: string
      blob: Blob
      fileName: string
      previewUrl: string
      sourceFloorPlanId: string | null
      annotationData: AnnotationData
    }

// ─── Persisted attachment (post-commit, from public.attachments) ─────────────
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
