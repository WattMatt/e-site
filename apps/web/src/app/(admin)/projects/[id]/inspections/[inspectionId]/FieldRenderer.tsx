'use client'

import type { Field, Response as InspectionResponse } from '@esite/shared'
import PassFailField from './fields/PassFailField'
import NumberField from './fields/NumberField'
import TextField from './fields/TextField'
import DropdownField from './fields/DropdownField'
import DateField from './fields/DateField'
import PhotoField from './fields/PhotoField'
import SignatureField from './fields/SignatureField'
import FileField from './fields/FileField'
import HeaderField from './fields/HeaderField'
import ComputedField from './fields/ComputedField'
import RepeatingGroupField from './fields/RepeatingGroupField'

export interface RendererProps {
  field: Field
  response?: InspectionResponse
  inspectionId: string
  sectionId: string
  readOnly: boolean
  verifierFlipMode: boolean
  onChange: (patch: Partial<InspectionResponse>) => void
  // Optional escape hatch for repeating_group: when provided, the renderer
  // can read sibling sub-field responses (to render hydrated entries on
  // reload) and can write to synthetic field_ids without going through the
  // parent's `onChange` (which is keyed to the group field_id, not the
  // synthetic id).
  allResponses?: InspectionResponse[]
  onUpsert?: (fieldId: string, patch: Partial<InspectionResponse>) => void
}

export default function FieldRenderer(p: RendererProps) {
  switch (p.field.type) {
    case 'pass_fail':
      return <PassFailField {...p} />
    case 'number':
      return <NumberField {...p} />
    case 'text':
    case 'textarea':
      return <TextField {...p} />
    case 'dropdown':
    case 'multi_select':
      return <DropdownField {...p} />
    case 'date':
      return <DateField {...p} />
    case 'photo':
      return <PhotoField {...p} />
    case 'signature':
      return <SignatureField {...p} />
    case 'file':
      return <FileField {...p} />
    case 'header':
      return <HeaderField {...p} />
    case 'computed':
      return <ComputedField {...p} />
    case 'repeating_group':
      return <RepeatingGroupField {...p} />
    default:
      return null
  }
}
